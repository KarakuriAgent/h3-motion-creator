import { describe, expect, it } from 'vitest'
import { judgeEnv, GEMX_WEIGHTS, type EnvFacts } from '../server/env-check'
import { DEFAULT_SETTINGS, findAppRoot } from '../server/config'
import { loadWorkflow, modelFiles, NODE_SOURCES, requiredClassTypes } from '../server/workflow'
import { setupRequestText } from '../server/texts'

const root = findAppRoot()
const graph = loadWorkflow(root)

/** 全部そろった環境の事実 */
function goodFacts(): EnvFacts {
  return {
    gpu: { name: 'Test GPU', memoryMiB: 16384, usedMiB: 1000 },
    ffmpeg: { ffmpeg: '/usr/bin/ffmpeg', ffprobe: '/usr/bin/ffprobe' },
    comfy: { dirExists: true, hasMain: true, python: '/c/venv/bin/python' },
    sageattention: { ok: true },
    models: modelFiles(graph).map((need) => ({ need, path: `/c/models/${need.folder}/${need.name}`, inObjectInfo: true })),
    nodeSources: NODE_SOURCES.map((s) => ({ label: s.label, kind: s.kind, repo: s.repo, classTypes: s.classTypes, found: '/c/x' })),
    url: { reachable: true, version: '0.41.0' },
    objectInfo: { required: requiredClassTypes(graph), missing: [] },
    gemx: { dirExists: true, hasDemo: true },
    gemxVenv: { python: '/g/.venv/bin/python', exists: true, ok: true, torch: '2.10.0', cuda: true, missingModules: [] },
    gemxWeights: GEMX_WEIGHTS.map((rel) => ({ rel, exists: true })),
  }
}

const settings = { ...DEFAULT_SETTINGS, comfyuiPath: '/c', gemxPath: '/g' }

describe('ワークフローから要る物を取り出す', () => {
  it('H3 の本体と LoRA 2 本・VAE 2 つ・テキストエンコーダ', () => {
    const names = modelFiles(graph).map((m) => m.name)
    expect(names).toContain('minimax_h3_fl2va_pruned_w4a8_mixed.safetensors')
    expect(names).toContain('minimax_h3_ref_lora_rank_256_bf16.safetensors')
    expect(names).toContain('minimax_h3_fl2v_turbo_4step_v1.3_768p_comfyui_bf16.safetensors')
    expect(modelFiles(graph).filter((m) => m.group === 'main')).toHaveLength(3)
    expect(modelFiles(graph).filter((m) => m.group === 'support')).toHaveLength(3)
  })
  it('参照動画・音声のローダーは要るノードに入らない', () => {
    const req = requiredClassTypes(graph)
    expect(req).toContain('MiniMaxH3ReferenceToVideo')
    expect(req).toContain('PathchSageAttentionKJ')
    expect(req).not.toContain('LoadVideo')
    expect(req).not.toContain('LoadAudio')
  })
})

describe('環境チェックの判定', () => {
  it('全部そろっていれば ready', () => {
    const r = judgeEnv(goodFacts(), { root, settings })
    expect(r.ready).toBe(true)
    expect(r.items.filter((i) => i.state === 'missing')).toEqual([])
    expect(setupRequestText(r, { serverUrl: 'http://127.0.0.1:4170', appRoot: root })).toBeNull()
  })

  it('URL につながらなければ、起動とノードの登録が無い', () => {
    const f = goodFacts()
    f.url = { reachable: false, error: 'ECONNREFUSED' }
    f.objectInfo = null
    const r = judgeEnv(f, { root, settings })
    expect(r.ready).toBe(false)
    expect(r.items.find((i) => i.id === 'comfyui_running')?.state).toBe('missing')
    expect(r.items.find((i) => i.id === 'comfyui_nodes')?.state).toBe('missing')
    // パスで調べる物はそのまま OK
    expect(r.items.find((i) => i.id === 'h3_models')?.state).toBe('ok')
  })

  it('LoRA のファイルが無ければ H3 の項目が無い・名前が出る', () => {
    const f = goodFacts()
    const lora = f.models.find((m) => m.need.name.includes('ref_lora'))!
    lora.path = null
    lora.inObjectInfo = false
    const r = judgeEnv(f, { root, settings })
    const item = r.items.find((i) => i.id === 'h3_models')!
    expect(item.state).toBe('missing')
    expect(item.fix).toContain('loras/minimax_h3_ref_lora_rank_256_bf16.safetensors')
  })

  it('SageAttention が import できなければ無い', () => {
    const f = goodFacts()
    f.sageattention = { ok: false, error: "No module named 'sageattention'" }
    expect(judgeEnv(f, { root, settings }).items.find((i) => i.id === 'sageattention')?.state).toBe('missing')
  })

  it('パスが空なら vendor/ を見て、セットアップの依頼文に clone して作ると書く', () => {
    const f = goodFacts()
    f.comfy = { dirExists: false, hasMain: false, python: null }
    f.sageattention = null
    f.models = f.models.map((m) => ({ ...m, path: null }))
    f.nodeSources = f.nodeSources.map((s) => ({ ...s, found: null }))
    f.gemx = { dirExists: false, hasDemo: false }
    f.gemxVenv = { python: `${root}/vendor/GEM-X/.venv/bin/python`, exists: false, ok: false }
    f.gemxWeights = f.gemxWeights.map((w) => ({ ...w, exists: false }))
    const ctx = { root, settings: { ...DEFAULT_SETTINGS } }
    const r = judgeEnv(f, ctx)
    expect(r.resolved.comfyuiPath).toBe(`${root}/vendor/ComfyUI`)
    expect(r.resolved.gemxPath).toBe(`${root}/vendor/GEM-X`)
    // パスが無ければ、URL の ComfyUI にモデルがあっても OK にしない
    expect(r.items.find((i) => i.id === 'h3_models')?.state).toBe('missing')
    const text = setupRequestText(r, { serverUrl: 'http://127.0.0.1:4170', appRoot: root })!
    expect(text).toContain('vendor/ComfyUI に clone して作る')
    expect(text).toContain('vendor/GEM-X に clone して作る')
    expect(text).toContain('既にある ComfyUI・システムの CUDA とドライバは変えない')
    // URL の ComfyUI は動いているので、そのフォルダを使えないか人に確かめるよう書く
    expect(text).toContain('もう動いている')
    // 済んでいる物は触らない
    expect(text).toMatch(/済んでいる物（触らない）: GPU（CUDA）・ffmpeg/)
  })

  it('GEM-X の venv で CUDA が使えなければ無い', () => {
    const f = goodFacts()
    f.gemxVenv = { ...f.gemxVenv, ok: false, cuda: false, missingModules: [] }
    const item = judgeEnv(f, { root, settings }).items.find((i) => i.id === 'gemx_venv')!
    expect(item.state).toBe('missing')
    expect(item.detail).toContain('CUDA')
  })
})
