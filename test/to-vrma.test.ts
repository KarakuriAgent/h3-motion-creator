import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error JS のモジュール（tools/to_vrma）
import { convertGlb, measureWalkSpeed, sampleGlb, writeVrma } from '../tools/to_vrma/convert.mjs'
import { fakeSomaGlb } from './helpers'

const DEG = 180 / Math.PI

describe('骨の glb → .vrma', () => {
  it('SOMA の骨を VRM の骨に対応させ、T ポーズの基本姿勢なら直しはほぼ 0', () => {
    const out = convertGlb(fakeSomaGlb())
    expect(out.rig.bones).toContain('hips')
    expect(out.rig.bones).toContain('leftUpperArm')
    expect(out.rig.parent.leftUpperArm).toBe('leftShoulder')
    expect(out.report.tposeCorrectionDeg.upperArm).toBeLessThan(0.01)
  })

  it('1 回の動き: 始めと終わりの両足の真ん中が原点・元の動画の始まりを書く', () => {
    const out = convertGlb(fakeSomaGlb(), { from: 0.2 })
    expect(out.info.sourceStartSec).toBeCloseTo(0.2, 2)
    expect(out.info.loop).toBe(false)
    const h = out.anim.hips
    // 腰は z に進む（始めと終わりの真ん中が原点なので、始めは負・終わりは正）
    expect(h[0].z).toBeLessThan(0)
    expect(h[h.length - 1].z).toBeGreaterThan(0)
  })

  it('その場: 進む分が消える', () => {
    const out = convertGlb(fakeSomaGlb(60), { inPlace: true })
    const h = out.anim.hips
    expect(Math.abs(h[h.length - 1].z - h[0].z)).toBeLessThan(0.1)
  })

  it('ループ: 最後のフレームが最初と同じ・腰の平均が原点', () => {
    const out = convertGlb(fakeSomaGlb(60), { loop: true, blend: 0.3, inPlace: true })
    const n = out.anim.times.length
    for (const b of out.rig.bones) expect(out.anim.rotations[b][n - 1].angleTo(out.anim.rotations[b][0])).toBeLessThan(1e-6)
    const mean = out.anim.hips.slice(0, -1).reduce((a: number, p: { x: number }) => a + p.x, 0) / (n - 1)
    expect(Math.abs(mean)).toBeLessThan(1e-3)
    expect(out.info.loop).toBe(true)
    expect(out.info.sourceStartSec).toBeCloseTo(0.3, 2)
  })

  it('左右を入れ替えると、左腕の動きが右腕に移る', () => {
    const plain = convertGlb(fakeSomaGlb())
    const mir = convertGlb(fakeSomaGlb(), { mirror: true })
    const i = 7
    expect(plain.anim.rotations.leftUpperArm[i].angleTo(plain.anim.rotations.leftUpperArm[0])).toBeGreaterThan(0.1)
    expect(mir.anim.rotations.rightUpperArm[i].angleTo(mir.anim.rotations.rightUpperArm[0])).toBeGreaterThan(0.1)
    expect(mir.anim.rotations.leftUpperArm[i].angleTo(mir.anim.rotations.leftUpperArm[0])).toBeLessThan(1e-6)
  })

  it('切り出す所にフレームが無ければ止まる', () => {
    expect(() => sampleGlb(fakeSomaGlb(), { from: 5, to: 6 })).toThrow(/フレームがありません/)
  })

  it('オプション無しなら、足したオプションの記録は書かない', () => {
    const out = convertGlb(fakeSomaGlb())
    expect(Object.keys(out.info).sort()).toEqual(['inPlace', 'loop', 'lowerBody', 'mirror', 'smooth', 'sourceEndSec', 'sourceStartSec'])
    expect(out.anim.walkSpeed).toBeUndefined()
  })

  it('立ち姿勢の向きを差し引く: 頭の前の傾きと横の回りが消え、ほかの骨は変わらない・残す角度も指定できる', () => {
    const glb = fakeSomaGlb(30, 30, { headPitchDeg: 25, headYawDeg: 10 })
    const plain = convertGlb(glb)
    expect(plain.anim.rotations.head[5].angleTo(plain.anim.rotations.head[0].clone().identity()) * DEG).toBeGreaterThan(20)
    const out = convertGlb(glb, { refSubtract: ['head'] })
    expect(out.anim.rotations.head[5].angleTo(out.anim.rotations.head[0].clone().identity()) * DEG).toBeLessThan(0.1)
    expect(out.info.refSubtract.head.pitch).toBeCloseTo(25, 0)
    expect(out.info.refSubtract.head.yaw).toBeCloseTo(10, 0)
    for (const b of out.rig.bones) if (b !== 'head') expect(out.anim.rotations[b][7].angleTo(plain.anim.rotations[b][7])).toBeLessThan(1e-6)
    const kept = convertGlb(glb, { refSubtract: ['head'], refKeep: 5 })
    expect(kept.anim.rotations.head[5].angleTo(kept.anim.rotations.head[0].clone().identity()) * DEG).toBeCloseTo(5, 1)
    expect(() => convertGlb(glb, { refSubtract: ['tail'] })).toThrow(/差し引く骨がありません/)
  })

  it('腰の置き場の直し: 前後・上下にずらす・終わりへ向けて引く・高さを立った高さにそろえる', () => {
    const plain = convertGlb(fakeSomaGlb())
    const n = plain.anim.hips.length
    const shifted = convertGlb(fakeSomaGlb(), { shiftHipsZ: -0.07 })
    expect(shifted.anim.hips[3].z - plain.anim.hips[3].z).toBeCloseTo(-0.07, 6)
    const lowered = convertGlb(fakeSomaGlb(), { shiftHipsY: -0.1 })
    expect(lowered.anim.hips[3].y - plain.anim.hips[3].y).toBeCloseTo(-0.1, 6)
    const drift = convertGlb(fakeSomaGlb(), { driftHipsZ: 0.1 })
    expect(drift.anim.hips[0].z - plain.anim.hips[0].z).toBeCloseTo(0, 6)
    expect(drift.anim.hips[n - 1].z - plain.anim.hips[n - 1].z).toBeCloseTo(-0.1, 6)
    const stand = convertGlb(fakeSomaGlb(), { hipsY: 'stand' })
    expect(stand.anim.hips.every((p: { y: number }) => Math.abs(p.y - 0.95) < 1e-6)).toBe(true)
    expect(stand.info.hipsY).toBeCloseTo(0.95, 4)
  })

  it('1 コマを止めたループ: 同じ姿勢が freezeLength 秒並び、腰の水平の位置は原点・元の動画の秒を書く', () => {
    const out = convertGlb(fakeSomaGlb(), { freeze: 0.26, freezeLength: 1.5 })
    const n = out.anim.times.length
    expect(n).toBe(46)
    expect(out.anim.times[n - 1]).toBeCloseTo(1.5, 6)
    for (const b of out.rig.bones) expect(out.anim.rotations[b][n - 1].angleTo(out.anim.rotations[b][0])).toBeLessThan(1e-6)
    // 止めたのは 0.26 秒にいちばん近い 8 コマ目（0.267 秒）の姿勢（左腕が上がっている）
    const src = convertGlb(fakeSomaGlb())
    expect(out.anim.rotations.leftUpperArm[0].angleTo(src.anim.rotations.leftUpperArm[8])).toBeLessThan(1e-6)
    expect(out.anim.hips.every((p: { x: number; z: number }) => p.x === 0 && p.z === 0)).toBe(true)
    expect(out.info.loop).toBe(true)
    expect(out.info.sourceStartSec).toBeCloseTo(0.2667, 3)
    expect(out.info.freezeLength).toBeCloseTo(1.5, 4)
    expect(() => convertGlb(fakeSomaGlb(), { freeze: 3 })).toThrow(/止める所/)
  })

  it('歩きの速さ: 床に着いた足が後ろへ動く速さの中央値を測り、extras.walkSpeed・legLength に書く', () => {
    const times = Array.from({ length: 20 }, (_, i) => i / 20)
    // 左足は床で後ろへ 1.1 m/s、右足は宙（測らない）
    const feet = times.map((t) => ({ L: { y: 0.05, z: -1.1 * t }, R: { y: 0.2 + 0.1 * Math.sin(t * 9), z: 2 * t } }))
    expect(measureWalkSpeed(feet, times)).toBeCloseTo(1.1, 6)

    const out = convertGlb(fakeSomaGlb(), { walkSpeed: 1.12 })
    expect(out.anim.walkSpeed).toBe(1.12)
    expect(out.anim.legLength).toBeCloseTo(0.84, 6)
    const path = join(mkdtempSync(join(tmpdir(), 'to-vrma-')), 'walk.vrma')
    writeVrma(path, out)
    const buf = readFileSync(path)
    const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)))
    const extras = json.animations[0].extras
    expect(extras.walkSpeed).toBe(1.12)
    expect(extras.legLength).toBeCloseTo(0.84, 4)
    expect(extras.h3MotionCreator.sourceStartSec).toBe(0)
    expect(convertGlb(fakeSomaGlb(), { walkSpeed: 1.12, legLength: 0.8 }).anim.legLength).toBe(0.8)
  })
})
