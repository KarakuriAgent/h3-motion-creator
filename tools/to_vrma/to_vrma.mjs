#!/usr/bin/env node
// 骨の glb（tools/gemx2glb.py が書く bones.glb）→ VRM Animation（motion.vrma）。アプリのフォルダで node で動かす（three はアプリの node_modules の物）。
// 使い方:
//   node tools/to_vrma/to_vrma.mjs --glb bones.glb --out motion.vrma [--from 秒] [--to 秒] [--smooth 0.05] [--loop [--blend 0.5]] [--in-place] [--lower-body neutral] [--mirror] [--name 名前]
//   --from・--to: 元の動画の秒で切り出す（既定は全部）。--smooth: 震えをならす強さ（ガウスの幅、秒。0 でならさない）
//   --loop: 終わりと始めを --blend 秒重ねて、切れ目なく繰り返すループにする（1 周期を --from・--to で切り出してから使う）
//   --in-place: 腰の水平の動き（進む分）を消してその場にする。--lower-body neutral: 腰から下をまっすぐ立った姿勢にする（上半身だけの身ぶり）
//   --mirror: 左右を入れ替える
//   --ref-subtract neck,head [--ref-window 0.3] [--ref-keep 度]: 始めの窓の平均の前後の傾きと横の回りを、その骨の回転から差し引く（立ち姿勢のうつむきを消す）。
//     --ref-keep: 差し引いたあとに残す下向きの角度（骨の合計）
//   --shift-hips-z m: 腰の前後の位置をずらす（+ が前。待機と足の場所をそろえる）。--drift-hips-z m: 始め 0 → 終わり m まで時間に比べて引く（前へ寄っていく分）
//   --shift-hips-y m: 腰の高さをずらす（+ が上。推定の床がずれて浮いた所を床に戻す）
//   --hips-y m|stand: 腰の高さを一定にする（stand = 切り出した所の始めの --ref-window 秒の平均の高さ）
//   --freeze 秒 [--freeze-length 1.5]: 元の動画のその秒の 1 コマを止めたループにする（跳んでいる間の姿勢など）
//   --walk-speed m/s|auto [--leg-length m]: 歩きの足が滑らない速さと脚の長さを extras.walkSpeed・legLength に書く（auto = 床に着いた足から測る。脚の既定は骨格から）
// 終わりに、始めと終わりの姿勢の差などを JSON で 1 行出す（[to_vrma] {...}）
import { convertFile } from './convert.mjs'

const argv = process.argv.slice(2)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const num = (f) => (opt(f) !== undefined ? Number(opt(f)) : undefined)
const numOr = (f, word) => (opt(f) === word ? word : num(f))
const glb = opt('--glb')
const out = opt('--out')
if (!glb || !out || argv.includes('--help')) {
  console.error(
    '使い方: node tools/to_vrma/to_vrma.mjs --glb bones.glb --out motion.vrma [--from 秒] [--to 秒] [--smooth 0.05] [--loop [--blend 0.5]] [--in-place] [--lower-body neutral] [--mirror]\n' +
      '  [--ref-subtract neck,head [--ref-window 0.3] [--ref-keep 度]] [--shift-hips-z m] [--shift-hips-y m] [--drift-hips-z m] [--hips-y m|stand]\n' +
      '  [--freeze 秒 [--freeze-length 1.5]] [--walk-speed m/s|auto [--leg-length m]]',
  )
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
    refSubtract: opt('--ref-subtract')?.split(',').filter(Boolean),
    refWindow: num('--ref-window'),
    refKeep: num('--ref-keep'),
    shiftHipsZ: num('--shift-hips-z'),
    shiftHipsY: num('--shift-hips-y'),
    driftHipsZ: num('--drift-hips-z'),
    hipsY: numOr('--hips-y', 'stand'),
    freeze: num('--freeze'),
    freezeLength: num('--freeze-length'),
    walkSpeed: numOr('--walk-speed', 'auto'),
    legLength: num('--leg-length'),
  })
  console.log(`[to_vrma] ${glb} -> ${out}`)
  console.log(`[to_vrma] ${JSON.stringify({ ...r.report, ...r.info })}`)
} catch (e) {
  console.error(`[to_vrma] ${e instanceof Error ? e.message : e}`)
  process.exit(1)
}
