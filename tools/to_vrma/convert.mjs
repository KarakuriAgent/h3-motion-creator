// 骨の glb（tools/gemx2glb.py が書く bones.glb。基本姿勢が T ポーズの骨組み + アニメーション 1 本）を、VRM Animation（.vrma）にする変換の本体。
// CLI は to_vrma.mjs。ここの処理の一部は sakurami-cho の tools/anim/convert.mjs（MIT License, Copyright (c) 2026 株式会社0235）を元に書き直した（THIRD_PARTY_NOTICES.md）。
//
// 置き換えの決まり（VRM Animation の仕様に合わせる）:
// - .vrma の骨は T ポーズを基準にする。素材の基本姿勢から、腕・脚・指はまっすぐの向き、親指は VRM の T ポーズの決まり
//   （手の向きと前の間、45 度）にそろえたものを「T ポーズ」とみなし、骨ごとに「T ポーズからどれだけ回ったか」を出す
// - 書き出す .vrma の骨は回転なし（T ポーズ）で置くので、アニメーションの回転がそのまま VRM の正規化した骨の回転になる
// - 向き: VRM は +Z が前・+X が本人の左。基本姿勢の左右の股関節を結ぶ向きが +X になるよう、Y 軸まわりに回してそろえる
//   （gemx2glb.py が前の向きをそろえてあるので、ふつうは回らない）
// - 腰（hips）の位置: 1 回の動き（既定）は、始めと終わりの 0.5 秒の両足の真ん中を原点に置く（待機から入って待機へ抜けるときに足が滑らない）。
//   ループは腰の水平の位置の平均を原点に置く
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Quaternion, Vector3 } from 'three'
import { SOMA_BONES } from './soma-bones.mjs'

// --- 1. glb を読む ---

export function parseGlb(buf) {
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('glTF バイナリではありません')
  const jsonLength = buf.readUInt32LE(12)
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength))
  const binStart = 20 + jsonLength
  const bin = buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart))
  const accessor = (index) => {
    const a = json.accessors[index]
    if (a.componentType !== 5126) throw new Error('float 以外のアクセサーには対応していません')
    const view = json.bufferViews[a.bufferView]
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
    const offset = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
    return new Float32Array(bin.buffer.slice(offset, offset + a.count * size * 4))
  }
  return { json, accessor }
}

/**
 * 骨の glb を、フレームごとの骨のワールドの回転（q）と位置（p）にする（VRM の骨の名前で。表に無い骨は飛ばす）。
 * 返す物: rest（基本姿勢）、frames、times（秒）、rig（VRM の骨の並びと親）
 */
export function sampleGlb(buf, { from = 0, to = Infinity, bones = SOMA_BONES } = {}) {
  const { json, accessor } = parseGlb(buf)
  const nodes = json.nodes
  const parent = new Array(nodes.length).fill(-1)
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)))
  const order = []
  const seen = new Set()
  const visit = (i) => {
    if (seen.has(i)) return
    if (parent[i] >= 0) visit(parent[i])
    seen.add(i)
    order.push(i)
  }
  nodes.forEach((_, i) => visit(i))
  const restT = nodes.map((n) => new Vector3().fromArray(n.translation ?? [0, 0, 0]))
  const restR = nodes.map((n) => new Quaternion().fromArray(n.rotation ?? [0, 0, 0, 1]))
  const anim = json.animations?.[0]
  if (!anim) throw new Error('glb にアニメーションがありません')
  let times = null
  const rotTracks = new Map()
  const posTracks = new Map()
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]
    const t = accessor(s.input)
    if (!times || t.length > times.length) times = t
    if (ch.target.path === 'rotation') rotTracks.set(ch.target.node, accessor(s.output))
    else if (ch.target.path === 'translation') posTracks.set(ch.target.node, accessor(s.output))
  }
  const byName = new Map(nodes.map((n, i) => [n.name, i]))
  const rig = resolveBones(bones, byName)

  const pose = (f) => {
    // f < 0 = 基本姿勢
    const wq = new Array(nodes.length)
    const wp = new Array(nodes.length)
    for (const i of order) {
      const lq = f >= 0 && rotTracks.has(i) ? new Quaternion().fromArray(rotTracks.get(i), f * 4) : restR[i].clone()
      const lp = f >= 0 && posTracks.has(i) ? new Vector3().fromArray(posTracks.get(i), f * 3) : restT[i].clone()
      const p = parent[i]
      if (p < 0) {
        wq[i] = lq
        wp[i] = lp
      } else {
        wq[i] = wq[p].clone().multiply(lq)
        wp[i] = lp.applyQuaternion(wq[p]).add(wp[p])
      }
    }
    const out = { q: {}, p: {} }
    for (const b of rig.bones) {
      const i = byName.get(bones[b])
      out.q[b] = wq[i]
      out.p[b] = wp[i]
    }
    return out
  }
  const idx = []
  for (let f = 0; f < times.length; f++) if (times[f] >= from - 1e-6 && times[f] <= to + 1e-6) idx.push(f)
  if (idx.length < 2) throw new Error(`切り出す所（${from}〜${to} 秒）にフレームがありません（素材は ${times.length} フレーム・${(times[times.length - 1] ?? 0).toFixed(2)} 秒）`)
  return {
    rest: pose(-1),
    frames: idx.map(pose),
    times: idx.map((f) => times[f] - times[idx[0]]),
    sourceStartSec: times[idx[0]],
    sourceEndSec: times[idx[idx.length - 1]],
    rig,
    name: anim.name ?? 'motion',
  }
}

// --- 2. VRM の骨（素材によらない決まり） ---

/** VRM の骨の親（VRM 1.0 の humanoid の親子）。親が先に来る順。素材に無い骨を飛ばすときは、そのさらに親につなぐ */
export const VRM_PARENT = { hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck' }
const LIMB_PARENT = {
  UpperLeg: '!hips',
  LowerLeg: 'UpperLeg',
  Foot: 'LowerLeg',
  Toes: 'Foot',
  Shoulder: '!upperChest',
  UpperArm: 'Shoulder',
  LowerArm: 'UpperArm',
  Hand: 'LowerArm',
  ThumbMetacarpal: 'Hand',
  ThumbProximal: 'ThumbMetacarpal',
  ThumbDistal: 'ThumbProximal',
  ...Object.fromEntries(
    ['Index', 'Middle', 'Ring', 'Little'].flatMap((f) => [
      [`${f}Proximal`, 'Hand'],
      [`${f}Intermediate`, `${f}Proximal`],
      [`${f}Distal`, `${f}Intermediate`],
    ]),
  ),
}
for (const side of ['left', 'right']) {
  for (const [bone, parent] of Object.entries(LIMB_PARENT)) VRM_PARENT[`${side}${bone}`] = parent.startsWith('!') ? parent.slice(1) : `${side}${parent}`
}

/** 必ず要る骨（VRM 1.0 の必須の骨） */
const REQUIRED = ['hips', 'spine', 'head', ...['left', 'right'].flatMap((s) => ['UpperLeg', 'LowerLeg', 'Foot', 'UpperArm', 'LowerArm', 'Hand'].map((b) => `${s}${b}`))]

/**
 * T ポーズで骨が向く方向（+X が本人の左、+Y が上、+Z が前）と、向きを測る相手の骨（骨の付け根 → 相手の付け根）。
 * 相手が無い骨（指先）は、親から自分への向きで測る。ここに無い骨（背骨・頭・足首など）は、基準の姿勢の向きのまま
 */
const TPOSE = {}
for (const [side, sign] of [
  ['left', 1],
  ['right', -1],
]) {
  const out = new Vector3(sign, 0, 0)
  const down = new Vector3(0, -1, 0)
  const thumb = new Vector3(sign, 0, 1).normalize()
  const set = (bone, dir, tip) => (TPOSE[`${side}${bone}`] = { dir, tip: tip && `${side}${tip}` })
  set('UpperLeg', down, 'LowerLeg')
  set('LowerLeg', down, 'Foot')
  set('UpperArm', out, 'LowerArm')
  set('LowerArm', out, 'Hand')
  set('Hand', out, 'MiddleProximal')
  set('ThumbMetacarpal', thumb, 'ThumbProximal')
  set('ThumbProximal', thumb, 'ThumbDistal')
  set('ThumbDistal', thumb)
  for (const f of ['Index', 'Middle', 'Ring', 'Little']) {
    set(`${f}Proximal`, out, `${f}Intermediate`)
    set(`${f}Intermediate`, out, `${f}Distal`)
    set(`${f}Distal`, out)
  }
}

/** 素材にある VRM の骨（親が先の順）と、素材に無い骨を飛ばした親 */
export function resolveBones(table, byName) {
  const missing = REQUIRED.filter((b) => !byName.has(table[b]))
  if (missing.length) throw new Error(`素材に必須の骨がありません: ${missing.map((b) => `${b}（${table[b] ?? '表に無し'}）`).join('、')}`)
  const bones = Object.keys(VRM_PARENT).filter((b) => table[b] && byName.has(table[b]))
  const have = new Set(bones)
  const parent = {}
  for (const b of bones) {
    let p = VRM_PARENT[b]
    while (p && !have.has(p)) p = VRM_PARENT[p]
    parent[b] = p
  }
  return { bones, parent }
}

// --- 3. 向き・左右・T ポーズ ---

/** 向きを VRM にそろえる Y 軸まわりの角度（左右の股関節を結ぶ向きを +X に） */
export function facingYaw(frame) {
  const v = frame.p.leftUpperLeg.clone().sub(frame.p.rightUpperLeg)
  return Math.atan2(v.z, v.x)
}

/** 姿勢を Y 軸まわりに回し、床の高さを引く（その場で書きかえる） */
export function turnAndLower(frames, yaw, floor) {
  if (Math.abs(yaw) < 1e-9 && floor === 0) return
  const r = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  for (const f of frames) {
    for (const b of Object.keys(f.q)) {
      f.q[b].premultiply(r)
      f.p[b].applyQuaternion(r).y -= floor
    }
  }
}

/** 左右を入れ替える（体の左右の真ん中の面 x = 0 で折り返す。回転 (x, y, z, w) は (x, -y, -z, w) になる）。新しい姿勢を返す */
export function mirrorFrame(f) {
  const swap = (b) => (b.startsWith('left') ? `right${b.slice(4)}` : b.startsWith('right') ? `left${b.slice(5)}` : b)
  const out = { q: {}, p: {} }
  for (const b of Object.keys(f.q)) {
    const q = f.q[b]
    out.q[swap(b)] = new Quaternion(q.x, -q.y, -q.z, q.w)
    out.p[swap(b)] = f.p[b].clone().setX(-f.p[b].x)
  }
  return out
}

/** 素材の基本姿勢から、骨ごとの「T ポーズでの向き（ワールドの回転）」と位置を作る。corrections は T ポーズにそろえるために回した角度（度） */
export function tPoseOf(rest, rig) {
  const { bones, parent } = rig
  const align = {}
  const world = {}
  const pos = {}
  const corrections = {}
  for (const b of bones) {
    const t = TPOSE[b]
    const p = parent[b]
    align[b] = new Quaternion()
    if (t) {
      // 親を直した分をまず受け継いでから（腕全体が A ポーズなら、手や指も一緒に回る）、残りの向きのずれだけ回す
      const inherited = p && TPOSE[p] ? align[p] : new Quaternion()
      const from = t.tip && rest.p[t.tip] ? rest.p[t.tip].clone().sub(rest.p[b]) : p ? rest.p[b].clone().sub(rest.p[p]) : null
      if (from && from.lengthSq() > 1e-12) {
        from.normalize().applyQuaternion(inherited)
        align[b].setFromUnitVectors(from, t.dir).multiply(inherited)
        corrections[b] = (2 * Math.acos(Math.min(1, Math.abs(align[b].w))) * 180) / Math.PI
      } else align[b].copy(inherited)
    }
    world[b] = align[b].clone().multiply(rest.q[b])
    // 位置: 親の骨をそろえた分だけ、親からの向きを回す
    pos[b] = p ? rest.p[b].clone().sub(rest.p[p]).applyQuaternion(align[p]).add(pos[p]) : rest.p[b].clone()
  }
  return { world, pos, corrections }
}

/** 補間で遠回りしないよう、前のフレームと同じ側の符号にそろえる */
function keepHemisphere(list) {
  for (let i = 1; i < list.length; i++) if (list[i].dot(list[i - 1]) < 0) list[i].set(-list[i].x, -list[i].y, -list[i].z, -list[i].w)
}

/** フレームごとの姿勢を、VRM の正規化した骨の回転（T ポーズからの回り → 親の回りを除いたもの）と腰・足の位置にする */
export function toNormalized(frames, tpose, rig) {
  const { bones, parent } = rig
  const inv = Object.fromEntries(bones.map((b) => [b, tpose.world[b].clone().invert()]))
  const rotations = Object.fromEntries(bones.map((b) => [b, []]))
  const delta = {}
  for (const f of frames) {
    for (const b of bones) delta[b] = f.q[b].clone().multiply(inv[b])
    for (const b of bones) {
      const q = delta[b].clone()
      if (parent[b]) q.premultiply(delta[parent[b]].clone().invert())
      rotations[b].push(q)
    }
  }
  for (const b of bones) keepHemisphere(rotations[b])
  const hips = frames.map((f) => f.p.hips.clone())
  const feet = frames.map((f) => ({ L: f.p.leftFoot.clone(), R: f.p.rightFoot.clone() }))
  return { rotations, hips, feet }
}

// --- 4. ならし・その場・ループ ---

/** ガウスのぼかしで震えをならす（sigma 秒。回転は符号をそろえて重み付きで足し、長さを 1 に戻す） */
export function smoothTrack(rotations, hips, times, sigma) {
  if (!sigma || times.length < 3) return
  const dt = times[1] - times[0]
  const radius = Math.max(1, Math.round((sigma * 3) / dt))
  const weights = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-0.5 * (((k - radius) * dt) / sigma) ** 2))
  const n = times.length
  const at = (i) => Math.min(n - 1, Math.max(0, i))
  for (const list of Object.values(rotations)) {
    const src = list.map((q) => q.clone())
    for (let i = 0; i < n; i++) {
      const s = [0, 0, 0, 0]
      weights.forEach((w, k) => {
        const q = src[at(i + k - radius)]
        const sign = q.dot(src[i]) < 0 ? -w : w
        s[0] += q.x * sign
        s[1] += q.y * sign
        s[2] += q.z * sign
        s[3] += q.w * sign
      })
      list[i].set(...s).normalize()
    }
  }
  const srcHips = hips.map((p) => p.clone())
  const total = weights.reduce((a, w) => a + w, 0)
  for (let i = 0; i < n; i++) {
    hips[i].set(0, 0, 0)
    weights.forEach((w, k) => hips[i].addScaledVector(srcHips[at(i + k - radius)], w / total))
  }
}

/**
 * 歩いて進む分を消して、その場にする（inPlace）: 腰の水平の位置をゆっくりならした道筋（ガウスのぼかし sigma 秒）を引く。
 * 細かい揺れ（体重移動・跳ねる）は残る。足も同じだけずらす
 */
export function keepInPlace(hips, feet, times, sigma = 0.6) {
  const n = hips.length
  if (n < 3) return
  const dt = times[1] - times[0]
  const radius = Math.max(1, Math.round((sigma * 3) / dt))
  // 端の外は、端を中心に点対称に折り返した値で埋める（一定の速さで進む分は端まで消える。端の値で埋めると、端で道筋が遅れて進む分が残る）
  const at = (j) => {
    if (j < 0) return hips[0].clone().multiplyScalar(2).sub(hips[Math.min(n - 1, -j)])
    if (j > n - 1) return hips[n - 1].clone().multiplyScalar(2).sub(hips[Math.max(0, 2 * (n - 1) - j)])
    return hips[j]
  }
  const path = hips.map((_, i) => {
    const v = new Vector3()
    let total = 0
    for (let k = -radius; k <= radius; k++) {
      const w = Math.exp(-0.5 * ((k * dt) / sigma) ** 2)
      v.addScaledVector(at(i + k), w)
      total += w
    }
    return v.divideScalar(total).setY(0)
  })
  const start = path[0].clone()
  hips.forEach((p, i) => {
    const d = path[i].clone().sub(start)
    p.sub(d)
    feet[i].L.sub(d)
    feet[i].R.sub(d)
  })
}

/** 腰から下の骨（lowerBody: 'neutral' で、まっすぐ立った姿勢にする骨） */
const LOWER_BONES = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes']

/**
 * 切れ目なく繰り返すループにする: 終わりの blend 秒と始めの blend 秒を重ねて混ぜる（[m..n-m) の後に [終わり × 始め] を混ぜてつなぎ、最後に最初のフレームを置く）。
 * 腰の水平の位置はループの中の平均を原点に。返す物の startFrame は、ループの 0 秒が元のどのフレームか
 */
function makeLoop(track, rig, dt, blend) {
  const n = track.hips.length
  const m = Math.max(1, Math.round(blend / dt))
  if (n < m * 2 + 1) throw new Error(`短すぎて、つなぎ目を ${blend} 秒重ねられません（${(n * dt).toFixed(2)} 秒）`)
  const rotations = Object.fromEntries(rig.bones.map((b) => [b, []]))
  const hips = []
  for (let i = m; i < n - m; i++) {
    for (const b of rig.bones) rotations[b].push(track.rotations[b][i].clone())
    hips.push(track.hips[i].clone())
  }
  for (let j = 0; j < m; j++) {
    const w = (j + 0.5) / m
    const s = w * w * (3 - 2 * w)
    const a = n - m + j
    for (const b of rig.bones) rotations[b].push(track.rotations[b][a].clone().slerp(track.rotations[b][j], s))
    hips.push(track.hips[a].clone().lerp(track.hips[j], s))
  }
  const mean = hips.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(hips.length).setY(0)
  hips.forEach((p) => p.sub(mean))
  // 最後に最初のフレームをもう一度置き、繰り返すときに最後 → 最初がなめらかにつながるようにする
  for (const b of rig.bones) {
    rotations[b].push(rotations[b][0].clone())
    keepHemisphere(rotations[b])
  }
  hips.push(hips[0].clone())
  return { rotations, hips, times: hips.map((_, i) => i * dt), startFrame: m }
}

/**
 * 骨の glb を .vrma の中身にする。opts:
 * - from・to: 元の動画の秒で切り出す / smooth: 震えをならす強さ（秒。既定 0.05）
 * - loop: true = 繰り返すループにする（blend = つなぎ目を重ねる秒。既定 0.5）
 * - inPlace: true = 腰の水平の動き（進む分）を消してその場にする
 * - lowerBody: 'neutral' = 腰から下をまっすぐ立った姿勢にする / mirror: true = 左右を入れ替える
 */
export function convertGlb(buf, opts = {}) {
  const s = sampleGlb(buf, { from: opts.from ?? 0, to: opts.to ?? Infinity })
  // 基本姿勢が T ポーズの素材（gemx2glb.py の骨組み）: 基本姿勢の向きで前にそろえる
  turnAndLower([s.rest, ...s.frames], facingYaw(s.rest), 0)
  let reference = s.rest
  let frames = s.frames
  if (opts.mirror) {
    frames = frames.map(mirrorFrame)
    reference = mirrorFrame(reference)
  }
  const tpose = tPoseOf(reference, s.rig)
  const { rotations, hips, feet } = toNormalized(frames, tpose, s.rig)
  smoothTrack(rotations, hips, s.times, opts.smooth ?? 0.05)
  if (opts.inPlace) keepInPlace(hips, feet, s.times)
  const dt = s.times[1] - s.times[0]
  let anim
  let sourceStartSec = s.sourceStartSec
  if (opts.loop) {
    // 立つ場所: 両足の真ん中の平均を原点に（ループは腰の平均を原点にそろえ直す）
    const center = new Vector3()
    feet.forEach((f) => center.add(f.L).add(f.R))
    center.divideScalar(feet.length * 2).setY(0)
    hips.forEach((p) => p.sub(center))
    const l = makeLoop({ rotations, hips }, s.rig, dt, opts.blend ?? 0.5)
    anim = { times: l.times, rotations: l.rotations, hips: l.hips }
    sourceStartSec += l.startFrame * dt
  } else {
    // 1 回の動き: 始めと終わり（ふつうに立っているところ）の両足の真ん中を原点に
    const k = Math.max(1, Math.min(15, Math.floor(feet.length / 4)))
    const ends = [...feet.slice(0, k), ...feet.slice(-k)]
    const center = ends.reduce((a, f) => a.add(f.L).add(f.R), new Vector3()).divideScalar(ends.length * 2).setY(0)
    hips.forEach((p) => p.sub(center))
    anim = { times: s.times, rotations, hips }
  }
  if (opts.lowerBody === 'neutral') {
    for (const b of LOWER_BONES) anim.rotations[b]?.forEach((q) => q.identity())
    anim.hips.forEach((p) => p.set(0, tpose.pos.hips.y, 0))
  }
  const info = {
    sourceStartSec: round(sourceStartSec),
    sourceEndSec: round(s.sourceEndSec),
    loop: !!opts.loop,
    inPlace: !!opts.inPlace,
    smooth: opts.smooth ?? 0.05,
    mirror: !!opts.mirror,
    lowerBody: opts.lowerBody ?? 'motion',
  }
  return { name: opts.name ?? s.name, rig: s.rig, tpose, anim, info, report: report(anim, s.rig, tpose) }
}

const round = (x) => Math.round(x * 10000) / 10000

/** 始めと終わりの姿勢の差・T ポーズへの直しの大きさ（表示用） */
function report(anim, rig, tpose) {
  const n = anim.times.length
  const step = (i, j) => Math.max(...rig.bones.map((b) => anim.rotations[b][i].angleTo(anim.rotations[b][j]))) * (180 / Math.PI)
  const deg = (...bs) => Math.max(0, ...bs.flatMap((b) => [tpose.corrections[`left${b}`] ?? 0, tpose.corrections[`right${b}`] ?? 0]))
  let usual = 0
  for (let i = 1; i < n; i++) usual = Math.max(usual, step(i - 1, i))
  return {
    frames: n,
    seconds: round(anim.times[n - 1]),
    startEndDeg: round(step(n - 1, 0)),
    startEndHipsCm: round(anim.hips[n - 1].distanceTo(anim.hips[0]) * 100),
    maxStepDeg: round(usual),
    tposeCorrectionDeg: { upperArm: round(deg('UpperArm')), lowerArm: round(deg('LowerArm')), upperLeg: round(deg('UpperLeg')), thumb: round(deg('ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal')) },
  }
}

// --- 5. .vrma（glTF + VRMC_vrm_animation）に書き出す ---

/**
 * 骨の回転と腰の位置の列を .vrma に書き出す。
 * - rig: { bones: VRM の骨の名前の並び（親が先）, parent: 骨 → 親の骨の名前（hips は null） }
 * - tpose: { pos: 骨 → T ポーズでのワールドの位置（骨組みはこの位置に回転なしで置く。腰の高さが再生するモデルとの大きさの比の基準） }
 * - anim: { times: 秒の並び, rotations: 骨 → 時刻ごとの正規化した骨のローカルの回転, hips: 時刻ごとの腰の位置 }
 * - info: アニメーションの extras.h3MotionCreator に書く（元の動画のどこからか・ループ・その場など。確認の画面が時刻を合わせるのに使う）
 */
export function writeVrma(path, { name, rig, tpose, anim, info }, generator = 'h3-motion-creator to_vrma') {
  const { bones, parent } = rig
  const chunks = []
  let byteLength = 0
  const accessors = []
  const bufferViews = []
  const addAccessor = (values, type, withMinMax = false) => {
    const data = Buffer.from(new Float32Array(values).buffer)
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length })
    chunks.push(data)
    byteLength += data.length
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]
    const a = { bufferView: bufferViews.length - 1, componentType: 5126, count: values.length / size, type }
    if (withMinMax) {
      a.min = [Math.min(...values)]
      a.max = [Math.max(...values)]
    }
    accessors.push(a)
    return accessors.length - 1
  }
  // 骨組み: VRM の骨の親子で並べ、回転なし（T ポーズ）で置く
  const index = Object.fromEntries(bones.map((b, i) => [b, i]))
  const nodes = bones.map((b) => {
    const p = parent[b] ? tpose.pos[b].clone().sub(tpose.pos[parent[b]]) : tpose.pos[b].clone().setX(0).setZ(0)
    const children = bones.filter((c) => parent[c] === b).map((c) => index[c])
    return { name: b, translation: p.toArray(), ...(children.length ? { children } : {}) }
  })
  const input = addAccessor(anim.times, 'SCALAR', true)
  const samplers = [{ input, output: addAccessor(anim.hips.flatMap((p) => p.toArray()), 'VEC3'), interpolation: 'LINEAR' }]
  const channels = [{ sampler: 0, target: { node: index.hips, path: 'translation' } }]
  for (const b of bones) {
    samplers.push({ input, output: addAccessor(anim.rotations[b].flatMap((q) => q.toArray()), 'VEC4'), interpolation: 'LINEAR' })
    channels.push({ sampler: samplers.length - 1, target: { node: index[b], path: 'rotation' } })
  }
  const json = {
    asset: { version: '2.0', generator },
    extensionsUsed: ['VRMC_vrm_animation'],
    extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones: Object.fromEntries(bones.map((b) => [b, { node: index[b] }])) } } },
    scene: 0,
    scenes: [{ nodes: [index.hips] }],
    nodes,
    animations: [{ name, channels, samplers, ...(info ? { extras: { h3MotionCreator: info } } : {}) }],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  }
  const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b)
  const jsonChunk = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const binChunk = pad(Buffer.concat(chunks), 0)
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)
  const chunkHeader = (length, type) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(length, 0)
    h.write(type, 4, 'ascii')
    return h
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.concat([header, chunkHeader(jsonChunk.length, 'JSON'), jsonChunk, chunkHeader(binChunk.length, 'BIN\0'), binChunk]))
}

export function convertFile(glbPath, outPath, opts = {}) {
  const out = convertGlb(readFileSync(glbPath), opts)
  writeVrma(outPath, out)
  return out
}

