// 起動時の環境チェック。probeEnv が実際に見て回り（パス・URL・コマンド）、judgeEnv が見た結果から項目ごとの判定を作る（judgeEnv は副作用なし。テストはこちら）
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePaths, resolveTools } from './config.js'
import { ffmpegInstallHint, findOnPath, pythonCandidates, pythonEnv } from './platform.js'
import type { CheckItem, EnvReport, Settings } from './shared.js'
import { loadWorkflow, MODEL_FOLDERS, modelFiles, NODE_SOURCES, requiredClassTypes, type ModelFileNeed } from './workflow.js'

/** GEM-X の重み（GEM-X のフォルダからの相対） */
export const GEMX_WEIGHTS = [
  'inputs/pretrained/gem_soma.ckpt',
  'inputs/checkpoints/vitpose/vitpose.pth',
  'inputs/checkpoints/sam-3d-body-dinov3/sam3d_body.ckpt',
  'inputs/mhr_data/mhr_model.pt',
  'inputs/soma_assets/SOMA_neutral.npz',
  'inputs/soma_data',
]

/** 見て回った結果（そのままの事実） */
export interface EnvFacts {
  ffmpeg: { ffmpeg: string | null; ffprobe: string | null }
  /** python: 見つかった ComfyUI の python（無ければ null）。pythonLooked: 見た所（設定の python か、探した候補） */
  comfy: { dirExists: boolean; hasMain: boolean; python: string | null; pythonLooked: string[] }
  sageattention: { ok: boolean; error?: string } | null
  models: { need: ModelFileNeed; path: string | null; inObjectInfo: boolean }[]
  nodeSources: { label: string; kind: 'custom' | 'core'; found: string | null; repo?: string; classTypes: string[] }[]
  url: { reachable: boolean; version?: string; error?: string }
  objectInfo: { missing: string[]; required: string[] } | null
  gemx: { dirExists: boolean; hasDemo: boolean }
  /** python: 見つかった GEM-X の python（無ければ null）。pythonLooked: 見た所 */
  gemxVenv: { python: string | null; pythonLooked: string[]; ok: boolean; torch?: string; error?: string; missingModules?: string[] }
  gemxWeights: { rel: string; exists: boolean }[]
}

export interface EnvContext {
  root: string
  settings: Settings
  /** 既定 process.platform（直し方の文を OS に合わせる） */
  platform?: NodeJS.Platform
}

// --- 見て回る ---

/** コマンドを動かして終わりの状態と出力を返す（サーバを止めないよう非同期で） */
function run(cmd: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<{ status: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((ok) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: opts.timeout ?? 60000, cwd: opts.cwd, maxBuffer: 1 << 24, env: pythonEnv(), windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : null) : 0
      ok({ status: code, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: err && code === null ? err.message : undefined })
    })
  })
}

/** モデルのファイルを models/<フォルダ>/ の下で探す（3 段まで。名前に / があればその相対パス） */
export function findModelFile(comfyPath: string, need: ModelFileNeed): string | null {
  for (const folder of MODEL_FOLDERS[need.folder]) {
    const base = join(comfyPath, 'models', folder)
    if (!existsSync(base)) continue
    const direct = join(base, need.name)
    if (existsSync(direct)) return direct
    const target = need.name.split('/').pop()!
    const stack: [string, number][] = [[base, 0]]
    while (stack.length) {
      const [dir, depth] = stack.pop()!
      let entries: string[] = []
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const e of entries) {
        const p = join(dir, e)
        if (e === target) return p
        if (depth < 3) {
          try {
            if (statSync(p).isDirectory()) stack.push([p, depth + 1])
          } catch {
            /* 壊れたリンクなどは飛ばす */
          }
        }
      }
    }
  }
  return null
}

function findNodeSource(comfyPath: string, s: (typeof NODE_SOURCES)[number]): string | null {
  if (s.kind === 'core') {
    const p = join(comfyPath, s.match)
    return existsSync(p) ? p : null
  }
  const dir = join(comfyPath, 'custom_nodes')
  if (!existsSync(dir)) return null
  const hit = readdirSync(dir).find((e) => e.toLowerCase().includes(s.match) && !e.endsWith('.disabled'))
  return hit ? join(dir, hit) : null
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export async function probeEnv(ctx: EnvContext): Promise<EnvFacts> {
  const t = resolveTools(ctx.root, ctx.settings)
  const graph = loadWorkflow(ctx.root)
  const needs = modelFiles(graph)
  const required = requiredClassTypes(graph)

  // URL
  let url: EnvFacts['url'] = { reachable: false }
  type ObjectInfo = Record<string, { input?: { required?: Record<string, unknown[]> } }>
  let objectInfo = null as ObjectInfo | null
  try {
    const stats = (await fetchJson(`${ctx.settings.comfyuiUrl}/system_stats`)) as { system?: { comfyui_version?: string } }
    url = { reachable: true, version: stats.system?.comfyui_version }
    objectInfo = (await fetchJson(`${ctx.settings.comfyuiUrl}/object_info`, 30000)) as ObjectInfo
  } catch (e) {
    url = { reachable: url.reachable, version: url.version, error: e instanceof Error ? e.message : String(e) }
  }
  const choices = (loader: string, input: string): string[] => {
    const spec = objectInfo?.[loader]?.input?.required?.[input] as unknown[] | undefined
    if (!spec) return []
    if (Array.isArray(spec[0])) return spec[0] as string[]
    const opts = (spec[1] as { options?: string[] } | undefined)?.options
    return Array.isArray(opts) ? opts : []
  }

  // ComfyUI のフォルダ
  const comfyDir = existsSync(t.comfyuiPath)
  const comfyPython = t.comfyuiPython && existsSync(t.comfyuiPython) ? t.comfyuiPython : null
  const looked = (setting: string | null, dir: string) => (setting ? [setting] : pythonCandidates(dir))
  const pp = resolvePaths(ctx.root, ctx.settings)
  let sage: EnvFacts['sageattention'] = null
  if (comfyPython) {
    const r = await run(comfyPython, ['-c', 'import sageattention'], { timeout: 120000, cwd: t.comfyuiPath })
    sage = r.status === 0 ? { ok: true } : { ok: false, error: lastLine(r.stderr || r.error || '') }
  }

  // GEM-X
  const gemxPython = t.gemxPython && existsSync(t.gemxPython) ? t.gemxPython : null
  const gemxVenv: EnvFacts['gemxVenv'] = { python: gemxPython, pythonLooked: looked(pp.gemxPythonSetting, t.gemxPath), ok: false }
  if (gemxPython) {
    const code = [
      'import importlib, json, sys',
      'missing = [m for m in ["torch", "numpy", "scipy", "cv2", "PIL", "hydra", "onnxruntime"] if importlib.util.find_spec(m) is None]',
      'out = {"missing": missing}',
      'try:',
      '    import torch; out["torch"] = torch.__version__',
      'except Exception as e:',
      '    out["error"] = str(e)',
      'print(json.dumps(out))',
    ].join('\n')
    const r = await run(gemxPython, ['-c', code], { timeout: 180000, cwd: t.gemxPath })
    try {
      const o = JSON.parse(lastLine(r.stdout) || '{}') as { missing: string[]; torch?: string; error?: string }
      Object.assign(gemxVenv, { torch: o.torch, error: o.error, missingModules: o.missing, ok: !o.missing.length && !o.error })
    } catch {
      gemxVenv.error = lastLine(r.stderr || r.error || '') || 'python を動かせません'
    }
  }

  return {
    ffmpeg: { ffmpeg: findOnPath('ffmpeg'), ffprobe: findOnPath('ffprobe') },
    comfy: { dirExists: comfyDir, hasMain: existsSync(join(t.comfyuiPath, 'main.py')), python: comfyPython, pythonLooked: looked(pp.comfyuiPythonSetting, t.comfyuiPath) },
    sageattention: sage,
    models: needs.map((need) => ({ need, path: comfyDir ? findModelFile(t.comfyuiPath, need) : null, inObjectInfo: choices(need.loader, need.input).includes(need.name) })),
    nodeSources: NODE_SOURCES.map((s) => ({ label: s.label, kind: s.kind, repo: s.repo, classTypes: s.classTypes, found: comfyDir ? findNodeSource(t.comfyuiPath, s) : null })),
    url,
    objectInfo: objectInfo ? { required, missing: required.filter((c) => !objectInfo![c]) } : null,
    gemx: { dirExists: existsSync(t.gemxPath), hasDemo: existsSync(join(t.gemxPath, 'scripts', 'demo', 'demo_soma.py')) },
    gemxVenv,
    gemxWeights: GEMX_WEIGHTS.map((rel) => ({ rel, exists: existsSync(join(t.gemxPath, rel)) })),
  }
}

// --- 判定 ---

/** 見た結果から、項目ごとの OK・無いを決める */
export function judgeEnv(f: EnvFacts, ctx: EnvContext): EnvReport {
  const t = resolvePaths(ctx.root, ctx.settings)
  const platform = ctx.platform ?? process.platform
  const items: CheckItem[] = []
  const where = (fromSettings: boolean, p: string, vendor: string) => (fromSettings ? `設定のパス ${p}` : `パス未指定 → ${vendor} を見た`)
  const comfyWhere = where(t.comfyuiPathFromSettings, t.comfyuiPath, 'vendor/ComfyUI')
  const gemxWhere = where(t.gemxPathFromSettings, t.gemxPath, 'vendor/GEM-X')
  const comfyOk = f.comfy.dirExists && f.comfy.hasMain

  items.push({
    id: 'ffmpeg',
    label: 'ffmpeg',
    state: f.ffmpeg.ffmpeg && f.ffmpeg.ffprobe ? 'ok' : 'missing',
    detail: f.ffmpeg.ffmpeg ? `${f.ffmpeg.ffmpeg}${f.ffmpeg.ffprobe ? '' : '（ffprobe が無い）'}` : 'PATH に ffmpeg が無い',
    fix: f.ffmpeg.ffmpeg && f.ffmpeg.ffprobe ? undefined : `ffmpeg と ffprobe を入れて PATH に通す（${ffmpegInstallHint(platform)}）`,
  })
  items.push({
    id: 'comfyui_path',
    label: 'ComfyUI の場所',
    state: comfyOk ? 'ok' : 'missing',
    detail: `${comfyWhere}${comfyOk ? '' : f.comfy.dirExists ? '（main.py が無い）' : '（無い）'}`,
    fix: comfyOk
      ? undefined
      : t.comfyuiPathFromSettings
        ? `設定のパス ${t.comfyuiPath} に ComfyUI が無い。パスを直すか、そこに ComfyUI を入れる（docs/setup.md §2）`
        : `パスの指定が無いので、プロジェクトの vendor/ComfyUI に clone して作る（git clone https://github.com/Comfy-Org/ComfyUI vendor/ComfyUI。venv は vendor/ComfyUI/venv。docs/setup.md §2）${
            f.url.reachable ? `。ただし ${ctx.settings.comfyuiUrl} で ComfyUI がもう動いている。そのフォルダが分かるなら、作らずに設定の ComfyUI のパスに書く（人に確かめる）` : ''
          }`,
  })
  items.push({
    id: 'comfyui_running',
    label: 'ComfyUI が起動している',
    state: f.url.reachable && f.objectInfo ? 'ok' : 'missing',
    detail: f.url.reachable ? `${ctx.settings.comfyuiUrl} の /system_stats · /object_info（ComfyUI ${f.url.version ?? '?'}）` : `${ctx.settings.comfyuiUrl} につながらない（${f.url.error ?? '?'}）`,
    fix: f.url.reachable && f.objectInfo ? undefined : `ComfyUI を起動する（${t.comfyuiPath} で ComfyUI の python main.py --listen 127.0.0.1 --port 8188 など）か、設定の URL を直す`,
  })
  const modelItem = (group: 'main' | 'support'): CheckItem => {
    const ms = f.models.filter((m) => m.need.group === group)
    // パスで調べる（ComfyUI の models/ の下）。extra_model_paths.yaml で別の所に置いた物は、同じ ComfyUI の /object_info に名前があれば OK
    const missing = ms.filter((m) => !m.path && !(comfyOk && m.inObjectInfo))
    const label = group === 'main' ? 'H3 の本体（fl2va）と LoRA 2 本' : 'H3 の VAE（映像・音声）とテキストエンコーダ'
    return {
      id: group === 'main' ? 'h3_models' : 'h3_support_models',
      label,
      state: missing.length ? 'missing' : 'ok',
      detail: ms.map((m) => `${m.need.name.replace(/\.safetensors$/, '')}${missing.includes(m) ? '（無い）' : ''}`).join(' · '),
      fix: missing.length ? `ComfyUI の models/ に入れる: ${missing.map((m) => `${m.need.folder}/${m.need.name}`).join('、')}（配布元は docs/setup.md §3）` : undefined,
    }
  }
  items.push(modelItem('main'))
  items.push(modelItem('support'))
  const nodeMissing = f.nodeSources.filter((s) => !s.found)
  items.push({
    id: 'custom_nodes',
    label: 'カスタムノード（MiniMax H3・KJNodes・Spectrum）',
    state: comfyOk && !nodeMissing.length ? 'ok' : 'missing',
    detail: comfyOk ? f.nodeSources.map((s) => `${s.label}${s.found ? '' : '（無い）'}`).join(' · ') : 'ComfyUI のフォルダが無いので見られない',
    fix:
      comfyOk && !nodeMissing.length
        ? undefined
        : !comfyOk
          ? `ComfyUI を作った後に、custom_nodes/ に ${f.nodeSources.filter((s) => s.kind === 'custom').map((s) => `${s.label}（${s.repo}）`).join('・')} を clone して requirements を ComfyUI の venv に入れる（MiniMax H3 のノードと BlockSparseAttention は新しい ComfyUI の本体に入っている。docs/setup.md §2.2）`
          : nodeMissing
            .map((s) => (s.kind === 'core' ? `${s.label}: ComfyUI の本体を ${s.classTypes.join('・')} が入った版にする（git pull。既にある ComfyUI なら人に確かめる）` : `${s.label}: custom_nodes/ に clone して requirements を ComfyUI の venv に入れる（${s.repo}）`))
            .join(' / '),
  })
  items.push({
    id: 'sageattention',
    label: 'SageAttention（ComfyUI の venv）',
    state: f.sageattention?.ok ? 'ok' : 'missing',
    detail: !f.comfy.python
      ? `ComfyUI の python が見つからない（見た所: ${f.comfy.pythonLooked.join('・')}）`
      : f.sageattention?.ok
        ? `${f.comfy.python} で import sageattention`
        : `import sageattention に失敗（${f.sageattention?.error ?? '?'}）`,
    fix: f.sageattention?.ok
      ? undefined
      : !f.comfy.python && t.comfyuiPythonSetting
        ? `設定の「ComfyUI の python」${t.comfyuiPythonSetting} が無い。パスを直すか、空にして自動で探させる`
        : !f.comfy.python && comfyOk
        ? 'ComfyUI の python が別の所にあるなら、設定の「ComfyUI の python」にそのパスを書く。無ければ ComfyUI の venv を作る（docs/setup.md §2.1）'
        : 'ComfyUI の python に SageAttention を入れる（GPU と torch の版に合う物。docs/setup.md §2.3）。入れたら ComfyUI の再起動が要る（人に確かめる）',
  })
  items.push({
    id: 'comfyui_nodes',
    label: 'ComfyUI にノードが登録されている',
    state: f.objectInfo && !f.objectInfo.missing.length ? 'ok' : 'missing',
    detail: f.objectInfo
      ? f.objectInfo.missing.length
        ? `/object_info に無い: ${f.objectInfo.missing.join(', ')}`
        : `/object_info にワークフローのノード ${f.objectInfo.required.length} 種が全部ある（MiniMaxH3ReferenceToVideo · PathchSageAttentionKJ ほか）`
      : 'ComfyUI につながらないので見られない',
    fix: f.objectInfo && !f.objectInfo.missing.length ? undefined : 'カスタムノードを入れた後に ComfyUI を再起動する（起動のログでノードの読み込みの失敗を見る）',
  })
  const gemxOk = f.gemx.dirExists && f.gemx.hasDemo
  items.push({
    id: 'gemx_path',
    label: 'GEM-X の場所',
    state: gemxOk ? 'ok' : 'missing',
    detail: `${gemxWhere}${gemxOk ? '' : f.gemx.dirExists ? '（scripts/demo/demo_soma.py が無い）' : '（無い）'}`,
    fix: gemxOk
      ? undefined
      : t.gemxPathFromSettings
        ? `設定のパス ${t.gemxPath} に GEM-X が無い。パスを直すか、そこに GEM-X を入れる（docs/setup.md §4）`
        : 'パスの指定が無いので、プロジェクトの vendor/GEM-X に clone して作る（git clone --recursive https://github.com/NVlabs/GEM-X vendor/GEM-X。docs/setup.md §4）',
  })
  items.push({
    id: 'gemx_venv',
    label: 'GEM-X の venv（torch・onnxruntime ほか）',
    state: f.gemxVenv.ok ? 'ok' : 'missing',
    detail: !f.gemxVenv.python
      ? `GEM-X の python が見つからない（見た所: ${f.gemxVenv.pythonLooked.join('・')}）`
      : f.gemxVenv.ok
        ? `${f.gemxVenv.python} · torch ${f.gemxVenv.torch}`
        : `足りない: ${[...(f.gemxVenv.missingModules ?? []), ...(f.gemxVenv.error ? [f.gemxVenv.error] : [])].join('、') || '?'}`,
    fix: f.gemxVenv.ok
      ? undefined
      : !f.gemxVenv.python && t.gemxPythonSetting
        ? `設定の「GEM-X の python」${t.gemxPythonSetting} が無い。パスを直すか、空にして自動で探させる`
        : !f.gemxVenv.python && gemxOk
        ? 'GEM-X の python が別の所にあるなら、設定の「GEM-X の python」にそのパスを書く。無ければ GEM-X のフォルダに uv で .venv を作り、GPU に合う CUDA の版の PyTorch・SOMA・onnxruntime-gpu を入れる（docs/setup.md §4）'
        : 'GEM-X のフォルダに uv で .venv を作り、GPU に合う CUDA の版の PyTorch・SOMA・onnxruntime-gpu を入れる（docs/setup.md §4）',
  })
  const wMissing = f.gemxWeights.filter((w) => !w.exists)
  items.push({
    id: 'gemx_weights',
    label: 'GEM-X の重み',
    state: wMissing.length ? 'missing' : 'ok',
    detail: wMissing.length ? `無い: ${wMissing.map((w) => w.rel).join(', ')}` : `${f.gemxWeights.length} 個（gem_soma · vitpose · sam3d_body · mhr · SOMA）`,
    fix: wMissing.length ? 'GEM-X の hf_utils で重みを取る・inputs/soma_assets のリンクを張る（docs/setup.md §4.4）' : undefined,
  })
  const ready = items.every((i) => i.state !== 'missing')
  return {
    checkedAt: new Date().toISOString(),
    settings: ctx.settings,
    resolved: {
      comfyuiPath: t.comfyuiPath,
      comfyuiPathFromSettings: t.comfyuiPathFromSettings,
      gemxPath: t.gemxPath,
      gemxPathFromSettings: t.gemxPathFromSettings,
      comfyuiPython: f.comfy.python,
      comfyuiPythonFromSettings: !!t.comfyuiPythonSetting,
      gemxPython: f.gemxVenv.python,
      gemxPythonFromSettings: !!t.gemxPythonSetting,
    },
    items,
    ready,
  }
}

/** 出力の最後の空でない行（Windows の \r\n も） */
function lastLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? ''
}

export async function checkEnv(ctx: EnvContext): Promise<EnvReport> {
  return judgeEnv(await probeEnv(ctx), ctx)
}
