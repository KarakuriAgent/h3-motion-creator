// 結果が置かれたら、確認用の動画を焼く: bones.mp4（骨。元の動画のカメラから）・vrm.mp4（VRM に .vrma を載せた物）・compare.mp4（① 元の動画 ② 骨 ③ VRM を並べた物）。
// 3 本とも元の動画と同じ時間の軸（30 コマ/秒・GEM-X に入れたコマ数）。骨と比較の動画は Python の道具（GEM-X の venv の python）、VRM の動画はヘッドレスのブラウザ
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTools, type Paths } from './config.js'
import { parseGlb, readVrmaInfo } from './gltf.js'
import { renderVrmVideo } from './render.js'
import { JOB_STATE_LABEL, type Job } from './shared.js'
import type { Store } from './store.js'
import type { Settings } from './shared.js'

export const PROOF_FPS = 30

function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((ok, ng) =>
    execFile(cmd, args, { cwd, maxBuffer: 1 << 26, timeout: 30 * 60 * 1000 }, (err, stdout, stderr) => (err ? ng(new Error(`${cmd} ${args[0] ?? ''}: ${String(stderr || err.message).trim().split('\n').slice(-5).join(' / ')}`)) : ok(String(stdout)))),
  )
}

/** 骨の glb のフレーム数（gemx2glb.py が書いた物。最初のアクセサーが時刻） */
export function glbFrames(path: string): number {
  const g = parseGlb(readFileSync(path))
  const s = g.json.animations?.[0]?.samplers?.[0]
  if (!s) throw new Error('bones.glb にアニメーションがありません')
  return g.json.accessors[s.input].count
}

export async function ffprobeSize(path: string): Promise<{ width: number; height: number; duration: number }> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path])
  const j = JSON.parse(out)
  return { width: j.streams[0].width, height: j.streams[0].height, duration: Number(j.format.duration) }
}

export interface BakeContext {
  store: Store
  paths: Paths
  settings: () => Settings
  serverUrl: string
}

/** 確認用の動画を焼くのに要るファイルがそろったか */
export function readyToBake(job: Job): boolean {
  return !!(job.files['source.mp4'] && job.files['bones.glb'] && job.files['motion.vrma'])
}

/** 1 本ずつ順に焼く（GPU・CPU を取り合わないように） */
export class ProofBaker {
  private chain: Promise<void> = Promise.resolve()
  private queued = new Set<string>()

  constructor(private ctx: BakeContext) {}

  /** 焼くのを予約する（同じ依頼がもう待っていれば何もしない） */
  schedule(id: string): void {
    if (this.queued.has(id)) return
    this.queued.add(id)
    const job = this.ctx.store.getJob(id)
    if (job) {
      job.proofs = { state: 'pending' }
      this.ctx.store.saveJob(job)
    }
    this.chain = this.chain
      .then(async () => {
        // 少し待つ（エージェントがファイルを続けて置くので、そろってから焼く）
        await new Promise((ok) => setTimeout(ok, 1500))
        this.queued.delete(id)
        await this.bake(id)
      })
      .catch(() => {})
  }

  idle(): Promise<void> {
    return this.chain
  }

  async bake(id: string): Promise<void> {
    const { store } = this.ctx
    let job = store.getJob(id)
    if (!job || !readyToBake(job)) return
    job.proofs = { state: 'running', at: new Date().toISOString() }
    store.saveJob(job)
    const dir = store.jobDir(id)
    try {
      const t = resolveTools(this.ctx.paths.root, this.ctx.settings())
      if (!existsSync(t.gemxPython)) throw new Error(`GEM-X の python がありません（${t.gemxPython}）。環境チェックを見る`)
      const src = join(dir, 'source.mp4')
      const frames = glbFrames(join(dir, 'bones.glb'))
      const { width, height } = await ffprobeSize(src)
      // 縦横比は元の動画のまま、高さ 864 にそろえる（16:9 なら幅 864 → 高さ 486）
      const h = width > height ? Math.round((864 * height) / width / 2) * 2 : 864
      const w = Math.round((h * width) / height / 2) * 2
      const vrma = readVrmaInfo(readFileSync(join(dir, 'motion.vrma')))
      const tools = join(this.ctx.paths.root, 'tools')
      // ① 骨
      await run(t.gemxPython, [join(tools, 'render_bones.py'), '--glb', join(dir, 'bones.glb'), '--stats', join(dir, 'stats.json'), '--source', src, '--out', join(dir, 'bones.mp4'), '--width', String(w), '--height', String(h), '--fps', String(PROOF_FPS)], tools)
      // ② VRM
      await renderVrmVideo(this.ctx.serverUrl, {
        vrmUrl: `/api/models/${job.modelId}/model.vrm`,
        vrmaUrl: `/api/jobs/${id}/files/motion.vrma`,
        out: join(dir, 'vrm.mp4'),
        width: w,
        height: h,
        fps: PROOF_FPS,
        frames,
        sourceStartSec: vrma.sourceStartSec,
      })
      // ③ 3 枠の比較
      job = store.getJob(id)!
      const info = {
        title: `${job.motion}（${job.id}）`,
        lines: qualityLines(job),
        sourceStartSec: vrma.sourceStartSec,
        vrmaSec: vrma.duration,
      }
      await run(t.gemxPython, [join(tools, 'make_compare.py'), '--source', src, '--bones', join(dir, 'bones.mp4'), '--vrm', join(dir, 'vrm.mp4'), '--frames', String(frames), '--fps', String(PROOF_FPS), '--info', JSON.stringify(info), '--out', join(dir, 'compare.mp4')], tools)
      job = store.getJob(id)!
      for (const n of ['bones.mp4', 'vrm.mp4', 'compare.mp4'] as const) store.markProof(job, n, statSync(join(dir, n)).size)
      job.proofs = { state: 'done', at: new Date().toISOString() }
      store.saveJob(job)
    } catch (e) {
      job = store.getJob(id)!
      job.proofs = { state: 'failed', error: e instanceof Error ? e.message : String(e), at: new Date().toISOString() }
      store.saveJob(job)
    }
  }
}

/** 比較の動画の見出しの下に書く行（品質の目安） */
export function qualityLines(job: Job): string[] {
  const q = job.quality ?? {}
  const parts: string[] = []
  if (q.footSlideCmPerSec !== undefined) parts.push(`足の滑り ${q.footSlideCmPerSec} cm/秒`)
  if (q.wristJitter !== undefined) parts.push(`手首の震え ${q.wristJitter} m/s²`)
  if (q.lowestPointMedianCm !== undefined) parts.push(`床 ${q.lowestPointMedianCm} cm`)
  if (q.startEndDeg !== undefined) parts.push(`始めと終わりの差 ${q.startEndDeg}°`)
  const extra: string[] = []
  if (job.seed !== undefined) extra.push(`seed ${job.seed}`)
  if (job.retries !== undefined) extra.push(`焼き直し ${job.retries}`)
  if (q.loop) extra.push('ループ')
  if (q.inPlace) extra.push('その場')
  extra.push(`${job.durationSec} 秒 · ${job.aspect} · ${JOB_STATE_LABEL[job.state]}`)
  return [parts.join('　'), extra.join(' · ')].filter(Boolean)
}
