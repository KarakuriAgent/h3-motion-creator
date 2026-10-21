// 作業データの読み書き: data/models/<id>/（model.vrm・threeview.png・meta.json）と data/jobs/<id>/（job.json・結果・確認用の動画）
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths } from './config.js'
import { motionSlug } from './texts.js'
import { DURATIONS, JOB_STATES, PROOF_FILES, RESULT_FILES, type Aspect, type Job, type JobState, type ModelInfo, type ProofFile, type ResultFile } from './shared.js'

const now = () => new Date().toISOString()

/** 一時ファイルに書いてから名前を変える（書きかけを読まない）。
 * 名前を変えられないファイルシステム（ネットワークのドライブの FUSE など）では、そのまま書く */
function writeJson(path: string, v: unknown): void {
  const text = JSON.stringify(v, null, 2) + '\n'
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  try {
    renameSync(tmp, path)
  } catch {
    writeFileSync(path, text)
    rmSync(tmp, { force: true })
  }
}

export class Store {
  constructor(readonly p: Paths) {}

  // --- モデル ---

  modelDir(id: string): string {
    return join(this.p.models, safeId(id))
  }

  newModelId(): string {
    return `m-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`
  }

  saveModel(m: ModelInfo): void {
    mkdirSync(this.modelDir(m.id), { recursive: true })
    writeJson(join(this.modelDir(m.id), 'meta.json'), m)
  }

  getModel(id: string): ModelInfo | undefined {
    const f = join(this.modelDir(id), 'meta.json')
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ModelInfo) : undefined
  }

  listModels(): ModelInfo[] {
    if (!existsSync(this.p.models)) return []
    return readdirSync(this.p.models)
      .map((id) => this.getModel(id))
      .filter((m): m is ModelInfo => !!m)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  // --- 依頼 ---

  jobDir(id: string): string {
    return join(this.p.jobs, safeId(id))
  }

  /** 依頼の id: <動きの英字>-<3 桁の連番>（wave-001）。同じ頭の依頼の続きの番号 */
  nextJobId(motion: string): string {
    const slug = motionSlug(motion)
    const used = existsSync(this.p.jobs) ? readdirSync(this.p.jobs).filter((d) => d.startsWith(`${slug}-`)) : []
    const max = used.map((d) => Number(d.slice(slug.length + 1))).filter((n) => Number.isInteger(n)).reduce((a, b) => Math.max(a, b), 0)
    return `${slug}-${String(max + 1).padStart(3, '0')}`
  }

  createJob(input: { modelId: string; motion: string; durationSec: number; aspect: Aspect; notes?: string }): Job {
    const motion = input.motion.trim()
    if (!motion) throw new BadRequest('動き（motion）が空です')
    if (!this.getModel(input.modelId)) throw new BadRequest(`モデル ${input.modelId} がありません`)
    if (!(DURATIONS as readonly number[]).includes(input.durationSec)) throw new BadRequest(`尺は ${DURATIONS.join('・')} 秒のどれか`)
    if (input.aspect !== '9:16' && input.aspect !== '16:9') throw new BadRequest('画角は 9:16 か 16:9')
    const id = this.nextJobId(motion)
    const t = now()
    const job: Job = {
      id,
      slug: id.replace(/-\d+$/, ''),
      modelId: input.modelId,
      motion,
      durationSec: input.durationSec,
      aspect: input.aspect,
      notes: input.notes?.trim() || undefined,
      createdAt: t,
      updatedAt: t,
      state: 'waiting',
      log: [{ at: t, state: 'waiting', message: '依頼を作った' }],
      files: {},
      proofs: { state: 'none' },
    }
    mkdirSync(this.jobDir(id), { recursive: true })
    this.saveJob(job)
    return job
  }

  saveJob(job: Job): void {
    job.updatedAt = now()
    writeJson(join(this.jobDir(job.id), 'job.json'), job)
  }

  getJob(id: string): Job | undefined {
    const f = join(this.jobDir(id), 'job.json')
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Job) : undefined
  }

  listJobs(): Job[] {
    if (!existsSync(this.p.jobs)) return []
    return readdirSync(this.p.jobs)
      .map((id) => this.getJob(id))
      .filter((j): j is Job => !!j)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** 進み具合（エージェントの POST /status） */
  setStatus(id: string, body: { state?: string; message?: string; seed?: number; retries?: number; findings?: string }): Job {
    const job = this.getJob(id)
    if (!job) throw new NotFound(`依頼 ${id} がありません`)
    const state = (body.state ?? job.state) as JobState
    if (!JOB_STATES.includes(state)) throw new BadRequest(`state は ${JOB_STATES.join(' / ')} のどれか`)
    if (body.seed !== undefined && !Number.isFinite(Number(body.seed))) throw new BadRequest('seed は数')
    if (body.retries !== undefined && !Number.isInteger(Number(body.retries))) throw new BadRequest('retries は整数')
    job.state = state
    if (body.message !== undefined) job.message = String(body.message)
    if (body.seed !== undefined) job.seed = Number(body.seed)
    if (body.retries !== undefined) job.retries = Number(body.retries)
    if (body.findings !== undefined) job.findings = String(body.findings)
    job.log.push({ at: now(), state, ...(body.message ? { message: String(body.message) } : {}) })
    this.saveJob(job)
    return job
  }

  /** 結果のファイルを置く（エージェントの PUT /files/{name}）。中身の確かめは呼ぶ側 */
  putFile(id: string, name: string, data: Buffer): Job {
    const job = this.getJob(id)
    if (!job) throw new NotFound(`依頼 ${id} がありません`)
    if (!(RESULT_FILES as readonly string[]).includes(name)) throw new BadRequest(`置けるファイルは ${RESULT_FILES.join('・')}`)
    if (!data.length) throw new BadRequest('中身が空です（curl --data-binary @ファイル で送る）')
    writeFileSync(join(this.jobDir(id), name), data)
    job.files[name as ResultFile] = { bytes: data.length, at: now() }
    this.saveJob(job)
    return job
  }

  /** 確認用の動画を書いたことを記録する */
  markProof(job: Job, name: ProofFile, bytes: number): void {
    job.files[name] = { bytes, at: now() }
  }

  fileExists(id: string, name: string): boolean {
    return ([...RESULT_FILES, ...PROOF_FILES] as string[]).includes(name) && existsSync(join(this.jobDir(id), name))
  }
}

export class BadRequest extends Error {
  status = 400
}
export class NotFound extends Error {
  status = 404
}

/** パスに使う id（英数字・-・_ だけ） */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new BadRequest(`id の形が違います: ${id}`)
  return id
}
