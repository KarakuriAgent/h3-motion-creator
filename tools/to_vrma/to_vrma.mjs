#!/usr/bin/env node
// 骨の glb（tools/gemx2glb.py が書く bones.glb）→ VRM Animation（motion.vrma）。アプリのフォルダで node で動かす（three はアプリの node_modules の物）。
// 使い方:
//   node tools/to_vrma/to_vrma.mjs --glb bones.glb --out motion.vrma [--from 秒] [--to 秒] [--smooth 0.05] [--loop [--blend 0.5]] [--in-place] [--lower-body neutral] [--mirror] [--name 名前]
//   --from・--to: 元の動画の秒で切り出す（既定は全部）。--smooth: 震えをならす強さ（ガウスの幅、秒。0 でならさない）
//   --loop: 終わりと始めを --blend 秒重ねて、切れ目なく繰り返すループにする（1 周期を --from・--to で切り出してから使う）
//   --in-place: 腰の水平の動き（進む分）を消してその場にする。--lower-body neutral: 腰から下をまっすぐ立った姿勢にする（上半身だけの身ぶり）
//   --mirror: 左右を入れ替える
// 終わりに、始めと終わりの姿勢の差などを JSON で 1 行出す（[to_vrma] {...}）
import { convertFile } from './convert.mjs'

const argv = process.argv.slice(2)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const num = (f) => (opt(f) !== undefined ? Number(opt(f)) : undefined)
const glb = opt('--glb')
const out = opt('--out')
if (!glb || !out || argv.includes('--help')) {
  console.error('使い方: node tools/to_vrma/to_vrma.mjs --glb bones.glb --out motion.vrma [--from 秒] [--to 秒] [--smooth 0.05] [--loop [--blend 0.5]] [--in-place] [--lower-body neutral] [--mirror]')
  process.exit(argv.includes('--help') ? 0 : 2)
}
try {
  const r = convertFile(glb, out, {
    from: num('--from'),
    to: num('--to'),
    smooth: num('--smooth'),
    loop: argv.includes('--loop'),
    blend: num('--blend'),
    inPlace: argv.includes('--in-place'),
    lowerBody: opt('--lower-body'),
    mirror: argv.includes('--mirror'),
    name: opt('--name'),
  })
  console.log(`[to_vrma] ${glb} -> ${out}`)
  console.log(`[to_vrma] ${JSON.stringify({ ...r.report, ...r.info })}`)
} catch (e) {
  console.error(`[to_vrma] ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
