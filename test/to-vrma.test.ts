import { describe, expect, it } from 'vitest'
// @ts-expect-error JS のモジュール（tools/to_vrma）
import { convertGlb, sampleGlb } from '../tools/to_vrma/convert.mjs'
import { fakeSomaGlb } from './helpers'

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
})
