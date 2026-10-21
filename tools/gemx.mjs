#!/usr/bin/env node
// 動画 1 本 → GEM-X の推定 → 骨の glb（bones.glb）と品質の目安（stats.json。元の動画のカメラも入る）。依存なし（Node 20 以上）。
//   node tools/gemx.mjs <動画.mp4> <出力のフォルダ> [--facing start|mean|ends] [--floor track|fixed] [--floor_window 秒] [--moving_cam] [--app http://127.0.0.1:4170]
//   出力: <出力のフォルダ>/bones.glb・stats.json・gemx-out/<動画の名前>/（hpe_results.pt・2D の関節を重ねた 0_kp2d77_overlay.mp4・30 コマ/秒にした動画）
//   GEM-X の場所: 環境変数 GEMX_ROOT。無ければアプリの設定（GET <アプリ>/api/settings の resolved.gemxPath。アプリの URL は --app、無ければ環境変数 APP_URL、既定 http://127.0.0.1:4170）
//   GEM-X の python: 環境変数 GEMX_PYTHON。無ければアプリの設定の resolved.gemxPython、それも無ければ GEM-X のフォルダの中を探す
//   推定は中間ファイルがあれば飛ばす（同じ名前の動画を作り直したら gemx-out/<名前>/ を消す）。--facing などを変えて glb だけ作り直すのは速い
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const die = (m, code = 1) => {
  console.error(m)
  process.exit(code)
}

const argv = process.argv.slice(2)
// --app <アプリの URL>（どこに置いてもよい）。無ければ環境変数 APP_URL、既定 http://127.0.0.1:4170
let appUrl = process.env.APP_URL || 'http://127.0.0.1:4170'
const ai = argv.indexOf('--app')
if (ai >= 0) {
  if (argv[ai + 1] === undefined) die('--app にはアプリの URL を続ける（例 --app http://127.0.0.1:4170）', 2)
  appUrl = argv.splice(ai, 2)[1]
}
appUrl = appUrl.replace(/\/+$/, '')
if (argv.length < 2 || argv[0].startsWith('--')) die('使い方: node tools/gemx.mjs <動画.mp4> <出力のフォルダ> [--facing start|mean|ends] [--floor track|fixed] [--floor_window 秒] [--moving_cam] [--app http://127.0.0.1:4170]', 2)
const video = resolve(argv[0])
const out = resolve(argv[1])
const glbArgs = []
const inferArgs = []
for (let i = 2; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--moving_cam') inferArgs.push(a)
  else if (['--facing', '--floor', '--floor_window'].includes(a) && argv[i + 1] !== undefined) glbArgs.push(a, argv[++i])
  else die(`知らないオプション: ${a}`, 2)
}
if (!existsSync(video)) die(`エラー: 動画がありません: ${video}`)

/** GEM-X のフォルダの中の python（OS ごとの venv の置き場） */
function findPython(dir) {
  const c = process.platform === 'win32' ? [join(dir, '.venv', 'Scripts', 'python.exe'), join(dir, 'venv', 'Scripts', 'python.exe')] : [join(dir, '.venv', 'bin', 'python'), join(dir, 'venv', 'bin', 'python')]
  return c.find((p) => isFile(p)) ?? null
}
function isFile(p) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

let gemxRoot = process.env.GEMX_ROOT || ''
let py = process.env.GEMX_PYTHON || ''
if (!gemxRoot || !py) {
  const s = await fetch(`${appUrl}/api/settings`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  gemxRoot ||= s?.resolved?.gemxPath ?? ''
  // アプリの python は、アプリと同じ GEM-X のフォルダを使うときだけ
  if (!py && s?.resolved?.gemxPython && s.resolved.gemxPath && resolve(s.resolved.gemxPath) === resolve(gemxRoot)) py = s.resolved.gemxPython
}
if (!gemxRoot || !existsSync(gemxRoot)) die(`エラー: GEM-X が見つかりません（GEMX_ROOT=${gemxRoot}。環境変数 GEMX_ROOT か、アプリの設定の GEM-X のパス。アプリ ${appUrl} の設定を見た。アプリが別の URL なら --app で渡す）`)
gemxRoot = resolve(gemxRoot)
py ||= findPython(gemxRoot) ?? ''
if (!py || !isFile(py)) die(`エラー: GEM-X の python が見つかりません（${py || gemxRoot}。環境変数 GEMX_PYTHON か、アプリの設定の GEM-X の python）`)

const name = parse(video).name
mkdirSync(join(out, 'gemx-out'), { recursive: true })

// GPU の空き（GEM-X は最大 8GiB ほど使う）。nvidia-smi が無ければ見ない
const smi = spawnSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true })
if (smi.status === 0) {
  const free = Number(smi.stdout.split(/\r?\n/)[0])
  if (free < 8192) console.error(`[gemx] 注意: GPU の空きが ${free} MiB です。足りなければ node tools/free_vram.mjs で ComfyUI のモデルを外す（ComfyUI は止めない）`)
}

const env = { ...process.env, GEMX_ROOT: gemxRoot, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
const runPy = (args) => {
  const r = spawnSync(py, args, { cwd: gemxRoot, env, stdio: 'inherit', windowsHide: true })
  if (r.error) die(`エラー: ${py} を起動できません: ${r.error.message}`)
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log(`[gemx] 推定: ${video}`)
runPy([join(here, 'gemx_infer.py'), '--video', video, '--output_root', join(out, 'gemx-out'), ...inferArgs])
console.log('[gemx] glb に書き出す')
runPy([join(here, 'gemx2glb.py'), '--in', join(out, 'gemx-out', name, 'hpe_results.pt'), '--out', join(out, 'bones.glb'), '--stats', join(out, 'stats.json'), ...glbArgs])
console.log(`[gemx] できた: ${join(out, 'bones.glb')}・${join(out, 'stats.json')}（2D の関節を重ねた動画: ${join(out, 'gemx-out', name, '0_kp2d77_overlay.mp4')}）`)
