// ローカルサーバ（Fastify）。画面とエージェントが叩く API（docs/design.md §5）と、画面・描画のページ・three.js のモジュールを配る
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDirs, loadSettings, makePaths, resolveTools, saveSettings } from './config.js'
import { checkEnv } from './env-check.js'
import { parseGlb, readVrmaInfo, readVrmMeta, summarizeQuality } from './gltf.js'
import { ProofBaker, readyToBake } from './proofs.js'
import { renderThreeView } from './render.js'
import { RESULT_FILES, PROOF_FILES, videoSize, type Aspect, type EnvReport, type Job, type ModelInfo, type Settings } from './shared.js'
import { BadRequest, NotFound, safeId, Store } from './store.js'
import { requestText, setupRequestText } from './texts.js'
import { WORKFLOW_FILE } from './workflow.js'

export interface AppOptions {
  /** アプリの根（このリポジトリ） */
  root: string
  /** 作業データの根（既定 <root>/data） */
  dataDir?: string
  /** 画面とエージェントに見せるサーバの URL（既定 http://127.0.0.1:4170） */
  serverUrl?: string
  /** false なら三面図・確認用の動画を焼かない（テスト用） */
  render?: boolean
  logger?: boolean
}

/** three.js などを /nm/ で配るパッケージ（描画のページの import map が読む） */
const NM_ALLOWED = ['three/', '@pixiv/three-vrm/', '@pixiv/three-vrm-animation/']

export async function buildApp(opts: AppOptions) {
  const paths = makePaths(opts.root, opts.dataDir)
  ensureDirs(paths)
  const store = new Store(paths)
  const serverUrl = (opts.serverUrl ?? 'http://127.0.0.1:4170').replace(/\/+$/, '')
  const render = opts.render ?? true
  let settings: Settings = loadSettings(paths)
  let lastEnv: EnvReport | null = null
  let envRunning: Promise<EnvReport> | null = null

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 * 1024 })
  const baker = new ProofBaker({ store, paths, settings: () => settings, serverUrl })

  // バイナリ（VRM・動画・glb）はそのまま Buffer で受ける。JSON は既定の読み方
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.setErrorHandler((err: Error & { status?: number; statusCode?: number }, _req, reply) => {
    const status = err.status ?? err.statusCode ?? 500
    reply.status(status).send({ error: err.message })
  })

  await app.register(fastifyStatic, { root: join(opts.root, 'render'), prefix: '/render/', decorateReply: true })
  const web = join(opts.root, 'dist/web')
  if (existsSync(web)) await app.register(fastifyStatic, { root: web, prefix: '/', decorateReply: false, index: ['index.html'] })

  // 描画のページが読む three.js・three-vrm（node_modules の中の決まったパッケージだけ）
  app.get('/nm/*', async (req, reply) => {
    const rel = (req.params as { '*': string })['*']
    if (!NM_ALLOWED.some((p) => rel.startsWith(p)) || rel.includes('..')) throw new NotFound('無い')
    return reply.sendFile(rel, join(opts.root, 'node_modules'))
  })

  // --- 環境チェック・設定 ---

  const runEnv = (): Promise<EnvReport> => {
    if (!envRunning) {
      envRunning = checkEnv({ root: opts.root, settings })
        .then((r) => (lastEnv = r))
        .finally(() => (envRunning = null))
    }
    return envRunning
  }

  app.get('/api/env', async (req) => {
    const q = req.query as { cached?: string }
    if (q.cached && lastEnv) return lastEnv
    return runEnv()
  })

  app.get('/api/setup-request', async () => {
    const env = lastEnv ?? (await runEnv())
    return { text: setupRequestText(env, { serverUrl, appRoot: opts.root }), env }
  })

  app.get('/api/settings', async () => ({ ...settings, resolved: resolveTools(opts.root, settings) }))

  app.put('/api/settings', async (req) => {
    const b = (req.body ?? {}) as Partial<Settings>
    if (typeof b !== 'object' || Buffer.isBuffer(b)) throw new BadRequest('JSON で送る（Content-Type: application/json）')
    settings = saveSettings(paths, { ...settings, ...pick(b, ['comfyuiPath', 'comfyuiUrl', 'gemxPath']) })
    lastEnv = null
    return { ...settings, resolved: resolveTools(opts.root, settings) }
  })

  // --- VRM と三面図 ---

  const startThreeView = (m: ModelInfo) => {
    if (!render) return
    m.threeview = { state: 'running' }
    store.saveModel(m)
    renderThreeView(serverUrl, `/api/models/${m.id}/model.vrm`, join(store.modelDir(m.id), 'threeview.png'))
      .then((r) => {
        const cur = store.getModel(m.id)!
        cur.threeview = { state: 'done', width: r.width, height: r.height, panelWidth: r.panelWidth }
        cur.heightM = Math.round(r.size[1] * 1000) / 1000
        store.saveModel(cur)
      })
      .catch((e) => {
        const cur = store.getModel(m.id)!
        cur.threeview = { state: 'failed', error: e instanceof Error ? e.message : String(e) }
        store.saveModel(cur)
      })
  }

  app.get('/api/models', async () => store.listModels())

  app.post('/api/models', async (req, reply) => {
    const body = req.body
    if (!Buffer.isBuffer(body) || !body.length) throw new BadRequest('VRM のファイルをそのまま送る（Content-Type: application/octet-stream）')
    const name = String((req.query as { name?: string }).name ?? 'model.vrm').replace(/[/\\]/g, '_').slice(0, 120)
    let meta
    try {
      meta = readVrmMeta(parseGlb(body).json)
    } catch (e) {
      throw new BadRequest(`VRM として読めません: ${e instanceof Error ? e.message : e}`)
    }
    const m: ModelInfo = { id: store.newModelId(), fileName: name, createdAt: new Date().toISOString(), bytes: body.length, meta, threeview: { state: 'pending' } }
    store.saveModel(m)
    writeFileSync(join(store.modelDir(m.id), 'model.vrm'), body)
    startThreeView(m)
    reply.status(201)
    return store.getModel(m.id)
  })

  app.get('/api/models/:id', async (req) => mustModel(store, (req.params as { id: string }).id))

  app.post('/api/models/:id/threeview', async (req) => {
    const m = mustModel(store, (req.params as { id: string }).id)
    startThreeView(m)
    return store.getModel(m.id)
  })

  app.get('/api/models/:id/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string }
    mustModel(store, id)
    if (file !== 'model.vrm' && file !== 'threeview.png') throw new NotFound('無い')
    if (!existsSync(join(store.modelDir(id), file))) throw new NotFound(`${file} はまだ無い`)
    return reply.sendFile(file, store.modelDir(id), { cacheControl: false })
  })

  // --- 依頼 ---

  app.get('/api/jobs', async () => store.listJobs())

  app.post('/api/jobs', async (req, reply) => {
    const b = (req.body ?? {}) as { modelId?: string; motion?: string; durationSec?: number; aspect?: Aspect; notes?: string }
    const job = store.createJob({ modelId: String(b.modelId ?? ''), motion: String(b.motion ?? ''), durationSec: Number(b.durationSec ?? 5), aspect: (b.aspect ?? '9:16') as Aspect, notes: b.notes })
    reply.status(201)
    return { job, text: requestText(job, store.getModel(job.modelId), { serverUrl, appRoot: opts.root }) }
  })

  app.get('/api/jobs/:id', async (req) => agentView(mustJob(store, (req.params as { id: string }).id)))

  app.get('/api/jobs/:id/request-text', async (req) => {
    const job = mustJob(store, (req.params as { id: string }).id)
    return { text: requestText(job, store.getModel(job.modelId), { serverUrl, appRoot: opts.root }) }
  })

  app.post('/api/jobs/:id/status', async (req) => {
    const b = req.body
    if (!b || typeof b !== 'object' || Buffer.isBuffer(b)) throw new BadRequest('JSON で送る（Content-Type: application/json）: {"state": "generating", "message": "…"}')
    return store.setStatus((req.params as { id: string }).id, b as Record<string, never>)
  })

  app.put('/api/jobs/:id/files/:name', async (req) => {
    const { id, name } = req.params as { id: string; name: string }
    mustJob(store, id)
    const raw = req.body
    const data = Buffer.isBuffer(raw) ? raw : raw && typeof raw === 'object' ? Buffer.from(JSON.stringify(raw, null, 2)) : Buffer.alloc(0)
    validateResult(name, data)
    let job = store.putFile(id, name, data)
    job = refreshQuality(store, job)
    if (render && readyToBake(job) && ['source.mp4', 'bones.glb', 'motion.vrma', 'stats.json'].includes(name)) baker.schedule(id)
    return store.getJob(id)
  })

  app.get('/api/jobs/:id/files/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string }
    const job = mustJob(store, id)
    if (!store.fileExists(id, name)) throw new NotFound(`${name} はまだ無い`)
    const dl = (req.query as { download?: string }).download
    if (dl) reply.header('Content-Disposition', `attachment; filename="${job.id}-${name}"`)
    return reply.sendFile(name, store.jobDir(id), { cacheControl: false })
  })

  app.post('/api/jobs/:id/proofs', async (req) => {
    const job = mustJob(store, (req.params as { id: string }).id)
    if (!readyToBake(job)) throw new BadRequest('source.mp4・bones.glb・motion.vrma がそろっていません')
    baker.schedule(job.id)
    return store.getJob(job.id)
  })

  // --- 比較の動画をまとめる ---

  app.post('/api/compare', async (req) => {
    const ids = ((req.body as { ids?: string[] } | undefined)?.ids ?? []).map(String)
    if (!ids.length) throw new BadRequest('ids（依頼の id の並び）を送る')
    const files = ids.map((id) => {
      mustJob(store, id)
      const f = join(store.jobDir(id), 'compare.mp4')
      if (!existsSync(f)) throw new BadRequest(`${id} の比較の動画がまだありません`)
      return f
    })
    const name = `compare-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${ids.length}.mp4`
    const list = join(paths.compare, `${name}.txt`)
    writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'\n`).join(''))
    await new Promise<void>((ok, ng) =>
      execFile('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', join(paths.compare, name)], (err, _o, se) => (err ? ng(new Error(`ffmpeg: ${se || err.message}`)) : ok())),
    )
    return { name, url: `/api/compare/${name}` }
  })

  app.get('/api/compare/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    if (!/^compare-[0-9T]+-\d+\.mp4$/.test(name) || !existsSync(join(paths.compare, name))) throw new NotFound('無い')
    reply.header('Content-Disposition', `attachment; filename="${name}"`)
    return reply.sendFile(name, paths.compare)
  })

  /** エージェントに渡す依頼の中身（GET /api/jobs/{id}） */
  function agentView(job: Job) {
    const m = store.getModel(job.modelId)
    const t = resolveTools(opts.root, settings)
    const api = `${serverUrl}/api/jobs/${job.id}`
    const { width, height } = videoSize(job.aspect)
    return {
      ...job,
      width,
      height,
      fps: 24,
      character: m && { modelId: m.id, fileName: m.fileName, name: m.meta.name, heightM: m.heightM, vrmPath: join(store.modelDir(m.id), 'model.vrm'), meta: m.meta },
      threeview: m && {
        state: m.threeview.state,
        url: `${serverUrl}/api/models/${m.id}/threeview.png`,
        path: join(store.modelDir(m.id), 'threeview.png'),
        width: m.threeview.width,
        height: m.threeview.height,
        layout: '正面・右側（本人の右）・後ろを横に並べた 1 枚。A ポーズ・正射影・背景 #f2f2f2。参照画像 <Picture 1> として渡す',
      },
      comfyui: { url: settings.comfyuiUrl, path: t.comfyuiPath },
      gemx: { path: t.gemxPath, python: t.gemxPython },
      app: {
        root: opts.root,
        serverUrl,
        workflow: join(opts.root, WORKFLOW_FILE),
        docs: { agentGuide: join(opts.root, 'docs/agent-guide.md'), h3Prompt: join(opts.root, 'docs/h3-prompt.md') },
        tools: {
          h3R2v: join(opts.root, 'tools/h3_r2v.mjs'),
          freeVram: join(opts.root, 'tools/free_vram.sh'),
          gemx: join(opts.root, 'tools/gemx.sh'),
          gemxInfer: join(opts.root, 'tools/gemx_infer.py'),
          gemx2glb: join(opts.root, 'tools/gemx2glb.py'),
          toVrma: join(opts.root, 'tools/to_vrma/to_vrma.mjs'),
        },
        workDir: join(store.jobDir(job.id), 'work'),
      },
      api: {
        status: `${api}/status`,
        files: Object.fromEntries(RESULT_FILES.map((n) => [n, `${api}/files/${n}`])),
        proofs: Object.fromEntries(PROOF_FILES.map((n) => [n, `${api}/files/${n}`])),
      },
    }
  }

  // Fastify のインスタンスは then を持つので、async の戻り値にそのまま入れず包んで返す
  return { app, store, baker, paths }
}

function pick<T extends object>(o: Partial<T>, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k]
  return out
}

function mustModel(store: Store, id: string): ModelInfo {
  const m = store.getModel(safeId(id))
  if (!m) throw new NotFound(`モデル ${id} がありません`)
  return m
}

function mustJob(store: Store, id: string): Job {
  const j = store.getJob(safeId(id))
  if (!j) throw new NotFound(`依頼 ${id} がありません`)
  return j
}

/** 置かれたファイルの中身を確かめる（形が違えば 400） */
export function validateResult(name: string, data: Buffer): void {
  if (!(RESULT_FILES as readonly string[]).includes(name)) throw new BadRequest(`置けるファイルは ${RESULT_FILES.join('・')}`)
  if (!data.length) throw new BadRequest('中身が空です（curl --data-binary @ファイル で送る）')
  try {
    if (name === 'source.mp4' && data.toString('ascii', 4, 8) !== 'ftyp') throw new Error('mp4 ではありません')
    if (name === 'bones.glb') {
      const g = parseGlb(data)
      if (!g.json.animations?.length) throw new Error('アニメーションがありません')
    }
    if (name === 'motion.vrma') readVrmaInfo(data)
    if (name === 'stats.json') JSON.parse(data.toString('utf8'))
  } catch (e) {
    throw new BadRequest(`${name} の形が違います: ${e instanceof Error ? e.message : e}`)
  }
}

/** stats.json と motion.vrma から品質の目安を作り直す */
function refreshQuality(store: Store, job: Job): Job {
  const dir = store.jobDir(job.id)
  const statsF = join(dir, 'stats.json')
  const vrmaF = join(dir, 'motion.vrma')
  const stats = existsSync(statsF) ? JSON.parse(readFileSync(statsF, 'utf8')) : null
  const vrma = existsSync(vrmaF) ? readVrmaInfo(readFileSync(vrmaF)) : null
  job.quality = summarizeQuality(stats, vrma)
  store.saveJob(job)
  return job
}

