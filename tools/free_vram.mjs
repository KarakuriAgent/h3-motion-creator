#!/usr/bin/env node
// ComfyUI を止めずに、読み込み済みのモデルを GPU のメモリから外す（ComfyUI の POST /free）。GEM-X を動かす前に、空きが足りなければ使う（任意）。依存なし（Node 20 以上）。
//   node tools/free_vram.mjs [--app http://127.0.0.1:4170]
//   接続先: 環境変数 COMFYUI_URL。無ければアプリの設定（GET <アプリ>/api/settings の comfyuiUrl。アプリの URL は --app、無ければ環境変数 APP_URL、既定 http://127.0.0.1:4170）、
//           それも取れなければ http://127.0.0.1:8188
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const ai = argv.indexOf('--app')
// 受けるのは --app <URL> だけ
if (!(argv.length === 0 || (argv.length === 2 && ai === 0))) {
  console.error('使い方: node tools/free_vram.mjs [--app http://127.0.0.1:4170]')
  process.exit(2)
}
const appUrl = ((ai >= 0 ? argv[ai + 1] : '') || process.env.APP_URL || 'http://127.0.0.1:4170').replace(/\/+$/, '')
let comfy = process.env.COMFYUI_URL || ''
if (!comfy) {
  const s = await fetch(`${appUrl}/api/settings`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  comfy = s?.comfyuiUrl || ''
}
comfy = (comfy || 'http://127.0.0.1:8188').replace(/\/+$/, '')

const ok = await fetch(`${comfy}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) })
  .then((r) => r.ok)
  .catch(() => false)
if (!ok) {
  console.error(`エラー: ComfyUI に接続できません: ${comfy}`)
  process.exit(1)
}
console.log(`GPU のメモリの解放を ${comfy} に頼みました（実行中のプロンプトがあれば、終わってから外れます）。`)

// nvidia-smi があれば、少し待ってから今の使用量を出す
await new Promise((r) => setTimeout(r, 2000))
const smi = spawnSync('nvidia-smi', ['--query-gpu=memory.used,memory.total', '--format=csv'], { encoding: 'utf8', windowsHide: true })
if (smi.status === 0) console.log(`\n${smi.stdout.trimEnd()}`)
