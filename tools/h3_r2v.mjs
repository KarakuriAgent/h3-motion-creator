#!/usr/bin/env node
// 同梱のワークフロー（workflows/minimax_h3_r2v_turbo.json。MiniMax H3 の r2v turbo）に、参照画像（三面図）・プロンプト・尺・大きさ・seed を差し込んで、
// ComfyUI に直接投げ、できた mp4 を取ってくる。依存なし（Node 20 以上の fetch・FormData）。差し込む所は docs/agent-guide.md §4
//
// 使い方:
//   node tools/h3_r2v.mjs --job <依頼 id> --prompt-file prompt.txt --out source.mp4 [--seed 123] [--app http://127.0.0.1:4170]
//     → 三面図・尺・大きさ・ComfyUI の URL は、アプリの GET /api/jobs/<id> から取る（アプリの URL は --app、無ければ環境変数 APP_URL、既定 http://127.0.0.1:4170）
//   node tools/h3_r2v.mjs --image threeview.png --prompt-file prompt.txt --duration 5 --width 480 --height 864 --out source.mp4 [--seed 123] [--comfy http://127.0.0.1:8188]
//   --graph <json>: ComfyUI に送ったグラフを書き出す（確かめ用） / --timeout <秒>: 待つ長さ（既定 1800）
// 終わりに 1 行の JSON（[h3_r2v] {"seed": …, "promptId": …, "out": …, "seconds": …}）を出す
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (f, d) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : d
}
const die = (m) => {
  console.error(`[h3_r2v] ${m}`)
  process.exit(1)
}

/** 参照画像 1 枚で投げるときに外すノード（雛形の参照動画・その音声・参照音声）と、MiniMaxH3ReferenceToVideo の入力 */
const UNUSED_NODES = ['140', '141', '142']
const UNUSED_INPUTS = ['ref_videos.ref_video_0', 'ref_video_audios.ref_video_audio_0', 'ref_audios.ref_audio_0']

async function main() {
  const appUrl = (opt('--app') || process.env.APP_URL || 'http://127.0.0.1:4170').replace(/\/+$/, '')
  let image = opt('--image')
  let duration = opt('--duration') && Number(opt('--duration'))
  let width = opt('--width') && Number(opt('--width'))
  let height = opt('--height') && Number(opt('--height'))
  let comfy = opt('--comfy')
  const jobId = opt('--job')
  if (jobId) {
    const r = await fetch(`${appUrl}/api/jobs/${jobId}`)
    if (!r.ok) die(`依頼 ${jobId} を取れません（${appUrl}。HTTP ${r.status}。アプリが別の URL なら --app で渡す）`)
    const j = await r.json()
    image ??= j.threeview?.path
    duration ||= j.durationSec
    width ||= j.width
    height ||= j.height
    comfy ??= j.comfyui?.url
  }
  if (!comfy) {
    const r = await fetch(`${appUrl}/api/settings`).catch(() => null)
    comfy = r?.ok ? (await r.json()).comfyuiUrl : 'http://127.0.0.1:8188'
  }
  comfy = comfy.replace(/\/+$/, '')
  const promptFile = opt('--prompt-file')
  const prompt = promptFile ? readFileSync(promptFile, 'utf8').trim() : opt('--prompt')
  const out = resolve(opt('--out', 'source.mp4'))
  const seed = opt('--seed') !== undefined ? Number(opt('--seed')) : Math.floor(Math.random() * 2 ** 47)
  if (!image) die('参照画像（--image か --job）が要ります')
  if (!prompt) die('プロンプト（--prompt-file か --prompt）が要ります')
  if (!duration || !width || !height) die('尺と大きさ（--duration・--width・--height か --job）が要ります')
  if (width % 32 || height % 32) die('幅と高さは 32 の倍数')
  if (/[぀-ヿ一-鿿]/.test(prompt)) die('プロンプトに日本語が入っています。H3 は英語で書く（docs/h3-prompt.md）')

  // 1. 参照画像を ComfyUI の input/ に上げる
  const fd = new FormData()
  fd.append('image', new Blob([readFileSync(image)], { type: 'image/png' }), basename(image).replace(/[^\w.-]/g, '_'))
  fd.append('overwrite', 'true')
  fd.append('type', 'input')
  fd.append('subfolder', 'h3-motion-creator')
  const up = await fetch(`${comfy}/upload/image`, { method: 'POST', body: fd })
  if (!up.ok) die(`参照画像を上げられません（${comfy}/upload/image。HTTP ${up.status}: ${await up.text()}）`)
  const upj = await up.json()
  const imageName = upj.subfolder ? `${upj.subfolder}/${upj.name}` : upj.name

  // 2. ワークフローに差し込む
  const g = JSON.parse(readFileSync(join(here, '../workflows/minimax_h3_r2v_turbo.json'), 'utf8'))
  for (const id of UNUSED_NODES) delete g[id]
  for (const k of UNUSED_INPUTS) delete g['136'].inputs[k]
  g['137'].inputs.image = imageName // LoadImage: 参照画像 = <Picture 1>
  g['138'].inputs.value = prompt // PrimitiveStringMultiline: プロンプト
  g['132'].inputs.value = duration // PrimitiveFloat: 尺（秒）→ ComfyMathExpression（131）が 24fps の 17k+5 のコマ数にする
  g['136'].inputs.width = width // MiniMaxH3ReferenceToVideo: 幅・高さ（ResolutionSelector（115）からのつなぎを数で上書き）
  g['136'].inputs.height = height
  g['129'].inputs.noise_seed = seed // RandomNoise: seed
  const prefix = `h3-motion-creator/${jobId ?? 'r2v'}-s${seed}`
  g['92'].inputs.filename_prefix = prefix // SaveVideo
  if (opt('--graph')) writeFileSync(opt('--graph'), JSON.stringify(g, null, 2))

  // 3. 投げる
  const t0 = Date.now()
  const res = await fetch(`${comfy}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: g, client_id: `h3-motion-creator-${process.pid}` }) })
  const rj = await res.json().catch(() => ({}))
  if (!res.ok) die(`ComfyUI が受け付けません（HTTP ${res.status}）: ${JSON.stringify(rj.node_errors ?? rj.error ?? rj).slice(0, 2000)}`)
  const promptId = rj.prompt_id
  console.log(`[h3_r2v] 投げた: prompt_id ${promptId}・seed ${seed}・${width}x${height}・${duration} 秒（${comfy}）`)

  // 4. 待つ
  const timeout = Number(opt('--timeout', 1800)) * 1000
  let entry = null
  while (Date.now() - t0 < timeout) {
    await new Promise((ok) => setTimeout(ok, 3000))
    const h = await fetch(`${comfy}/history/${promptId}`).then((r) => r.json()).catch(() => ({}))
    entry = h[promptId]
    if (entry?.status?.completed || entry?.status?.status_str === 'error') break
    entry = null
  }
  if (!entry) die(`${timeout / 1000} 秒待っても終わりません（prompt_id ${promptId}。ComfyUI の /queue を見る）`)
  if (entry.status?.status_str === 'error') {
    const msg = (entry.status.messages ?? []).filter(([k]) => k === 'execution_error').map(([, v]) => `${v.node_type}: ${v.exception_message}`)
    die(`ComfyUI の実行が失敗しました: ${msg.join(' / ') || JSON.stringify(entry.status).slice(0, 1000)}`)
  }

  // 5. できた動画を取ってくる
  const files = Object.values(entry.outputs?.['92'] ?? {})
    .flat()
    .filter((f) => f && typeof f === 'object' && f.filename)
  const file = files.find((f) => /\.(mp4|webm|mov)$/i.test(f.filename)) ?? files[0]
  if (!file) die(`出力が見つかりません: ${JSON.stringify(entry.outputs).slice(0, 1000)}`)
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' })
  const v = await fetch(`${comfy}/view?${q}`)
  if (!v.ok) die(`動画を取れません（HTTP ${v.status}）`)
  writeFileSync(out, Buffer.from(await v.arrayBuffer()))
  const seconds = Math.round((Date.now() - t0) / 100) / 10
  console.log(`[h3_r2v] ${JSON.stringify({ seed, promptId, out, comfyFile: `${file.subfolder ? file.subfolder + '/' : ''}${file.filename}`, seconds })}`)
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
