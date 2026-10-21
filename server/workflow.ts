// 同梱のワークフロー（workflows/minimax_h3_r2v_turbo.json）を読む。要るモデルのファイルとノードを、ワークフローから取り出す
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const WORKFLOW_FILE = 'workflows/minimax_h3_r2v_turbo.json'

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>

/** 参照画像 1 枚だけで投げるときに外すノード（雛形の参照動画・その音声・参照音声のローダー） */
export const UNUSED_REF_NODES = ['140', '141', '142']

/** ComfyUI のモデルのフォルダ（models/ の下）と、そのフォルダの別名 */
export const MODEL_FOLDERS: Record<string, string[]> = {
  diffusion_models: ['diffusion_models', 'unet'],
  loras: ['loras'],
  vae: ['vae'],
  text_encoders: ['text_encoders', 'clip'],
}

export interface ModelFileNeed {
  folder: keyof typeof MODEL_FOLDERS
  name: string
  /** object_info で選べる名前の一覧を持つノードと入力 */
  loader: string
  input: string
  /** H3 の本体と LoRA（本体の項目）か、VAE・テキストエンコーダ（支えの項目）か */
  group: 'main' | 'support'
}

export function loadWorkflow(root: string): Graph {
  return JSON.parse(readFileSync(join(root, WORKFLOW_FILE), 'utf8'))
}

/** ワークフローが読むモデルのファイル */
export function modelFiles(g: Graph): ModelFileNeed[] {
  const out: ModelFileNeed[] = []
  for (const n of Object.values(g)) {
    const i = n.inputs
    if (n.class_type === 'UNETLoader') out.push({ folder: 'diffusion_models', name: String(i.unet_name), loader: 'UNETLoader', input: 'unet_name', group: 'main' })
    if (n.class_type === 'LoraLoaderModelOnly') out.push({ folder: 'loras', name: String(i.lora_name), loader: 'LoraLoaderModelOnly', input: 'lora_name', group: 'main' })
    if (n.class_type === 'VAELoader') out.push({ folder: 'vae', name: String(i.vae_name), loader: 'VAELoader', input: 'vae_name', group: 'support' })
    if (n.class_type === 'CLIPLoader') out.push({ folder: 'text_encoders', name: String(i.clip_name), loader: 'CLIPLoader', input: 'clip_name', group: 'support' })
  }
  return out
}

/** 参照画像 1 枚で投げるときに ComfyUI に要るノード（外すノードを除いた class_type） */
export function requiredClassTypes(g: Graph): string[] {
  return [...new Set(Object.entries(g).filter(([id]) => !UNUSED_REF_NODES.includes(id)).map(([, n]) => n.class_type))].sort()
}

/**
 * ComfyUI の本体に入っていないノード（パスで調べる）。dir はカスタムノードのフォルダの名前（大文字小文字は見ない）
 * core は ComfyUI の本体のファイル（その版より新しい本体に入っている）
 */
export const NODE_SOURCES: { classTypes: string[]; kind: 'custom' | 'core'; match: string; label: string; repo?: string }[] = [
  { classTypes: ['MiniMaxH3ReferenceToVideo', 'MiniMaxH3SigmaShift'], kind: 'core', match: 'comfy_extras/nodes_minimax_h3.py', label: 'MiniMax H3 のノード（ComfyUI の本体に同梱）' },
  { classTypes: ['BlockSparseAttention'], kind: 'core', match: 'comfy_extras/nodes_sparse_attention.py', label: 'BlockSparseAttention（ComfyUI の本体に同梱）' },
  { classTypes: ['PathchSageAttentionKJ', 'MiniMaxH3MemoryEfficientSageAttentionPatch'], kind: 'custom', match: 'kjnodes', label: 'ComfyUI-KJNodes', repo: 'https://github.com/kijai/ComfyUI-KJNodes' },
  { classTypes: ['SpectrumApplyMiniMaxH3'], kind: 'custom', match: 'spectrum-minimax-h3', label: 'ComfyUI-Spectrum-MiniMax-H3', repo: 'https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3' },
]
