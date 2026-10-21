import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app'
import { findAppRoot } from '../server/config'
import { motionSlug } from '../server/texts'
// @ts-expect-error JS のモジュール（tools/to_vrma）
import { convertGlb, writeVrma } from '../tools/to_vrma/convert.mjs'
import { fakeSomaGlb, fakeVrm, makeGlb } from './helpers'

const root = findAppRoot()
let dir: string
let ctx: Awaited<ReturnType<typeof buildApp>>
let modelId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'h3mc-test-'))
  ctx = await buildApp({ root, dataDir: dir, render: false })
  const r = await ctx.app.inject({ method: 'POST', url: '/api/models?name=test.vrm', headers: { 'content-type': 'application/octet-stream' }, payload: fakeVrm() })
  expect(r.statusCode).toBe(201)
  modelId = r.json().id
})
afterAll(async () => {
  await ctx.app.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('VRM の登録', () => {
  it('メタ情報（利用条件）を読む', async () => {
    const m = (await ctx.app.inject({ method: 'GET', url: `/api/models/${modelId}` })).json()
    expect(m.meta.specVersion).toBe('1.0')
    expect(m.meta.avatarPermission).toBe('誰でも')
    expect(m.meta.warnings).toEqual([])
  })
  it('作者のみ・非営利・改変不可なら注意が出る', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/models?name=x.vrm', headers: { 'content-type': 'application/octet-stream' }, payload: fakeVrm({ avatarPermission: 'onlyAuthor', commercialUsage: 'personalNonProfit', modification: 'prohibited' }) })
    expect(r.json().meta.warnings.length).toBeGreaterThanOrEqual(3)
  })
  it('VRM 0.x のメタ情報もそろえて読む', async () => {
    const v0 = makeGlb({ asset: { version: '2.0' }, extensions: { VRM: { meta: { title: 'Old', author: 'a', allowedUserName: 'Everyone', commercialUssageName: 'Disallow', licenseName: 'CC_BY_ND' } } } })
    const m = (await ctx.app.inject({ method: 'POST', url: '/api/models?name=old.vrm', headers: { 'content-type': 'application/octet-stream' }, payload: v0 })).json()
    expect(m.meta.specVersion).toBe('0.x')
    expect(m.meta.commercialUsage).toBe('商用不可')
    expect(m.meta.modification).toBe('改変不可')
  })
  it('VRM でなければ 400', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/models', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('not a glb at all') })
    expect(r.statusCode).toBe(400)
  })
})

describe('依頼の作成', () => {
  it('id は動きの英字と連番。依頼文に API・手順書・動き・尺・画角が入る', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/jobs', payload: { modelId, motion: '手を振る', durationSec: 5, aspect: '9:16' } })
    expect(r.statusCode).toBe(201)
    const { job, text } = r.json()
    expect(job.id).toBe('wave-001')
    expect(job.state).toBe('waiting')
    expect(text).toContain('依頼 id: wave-001')
    expect(text).toContain('/api/jobs/wave-001')
    expect(text).toContain('docs/agent-guide.md')
    expect(text).toContain('「手を振る」 / 尺: 5 秒 / 画角: 9:16（480x864）')
    const r2 = await ctx.app.inject({ method: 'POST', url: '/api/jobs', payload: { modelId, motion: '手を振る', durationSec: 8, aspect: '16:9' } })
    expect(r2.json().job.id).toBe('wave-002')
  })
  it('知らない言葉は motion、英字はそのまま', () => {
    expect(motionSlug('くるっと回る')).toBe('motion')
    expect(motionSlug('Moonwalk back')).toBe('moonwalk-back')
    expect(motionSlug('照れる')).toBe('shy')
  })
  it('尺・画角・モデルが違えば 400', async () => {
    for (const payload of [
      { modelId, motion: 'x', durationSec: 7, aspect: '9:16' },
      { modelId, motion: 'x', durationSec: 5, aspect: '1:1' },
      { modelId: 'nope', motion: 'x', durationSec: 5, aspect: '9:16' },
      { modelId, motion: '  ', durationSec: 5, aspect: '9:16' },
    ]) {
      expect((await ctx.app.inject({ method: 'POST', url: '/api/jobs', payload })).statusCode).toBe(400)
    }
  })
  it('エージェントが取る中身に三面図・パス・API が入る', async () => {
    const j = (await ctx.app.inject({ method: 'GET', url: '/api/jobs/wave-001' })).json()
    expect(j.width).toBe(480)
    expect(j.height).toBe(864)
    expect(j.threeview.path).toContain(join('models', modelId, 'threeview.png'))
    expect(j.app.workflow).toBe(join(root, 'workflows', 'minimax_h3_r2v_turbo.json'))
    expect(j.api.files['motion.vrma']).toContain('/api/jobs/wave-001/files/motion.vrma')
    expect(j.comfyui.url).toBe('http://127.0.0.1:8188')
  })
})

describe('進み具合と結果の受け取り', () => {
  it('status を書くと記録に残る。知らない state は 400', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/jobs/wave-001/status', payload: { state: 'generating', message: 'H3 を焼いている', seed: 101 } })
    expect(r.statusCode).toBe(200)
    expect(r.json().seed).toBe(101)
    expect(r.json().log.at(-1).message).toBe('H3 を焼いている')
    expect((await ctx.app.inject({ method: 'POST', url: '/api/jobs/wave-001/status', payload: { state: 'flying' } })).statusCode).toBe(400)
  })

  it('結果のファイルを形を確かめて受け取り、品質の目安をまとめる', async () => {
    const put = (name: string, data: Buffer) => ctx.app.inject({ method: 'PUT', url: `/api/jobs/wave-001/files/${name}`, headers: { 'content-type': 'application/octet-stream' }, payload: data })
    // 形が違えば 400
    expect((await put('source.mp4', Buffer.from('xxxxnotmp4'))).statusCode).toBe(400)
    expect((await put('motion.vrma', fakeSomaGlb())).statusCode).toBe(400) // VRMC_vrm_animation が無い
    expect((await put('other.bin', Buffer.from('x'))).statusCode).toBe(400)
    // 正しい物
    const mp4 = Buffer.alloc(64)
    mp4.write('ftypisom', 4, 'ascii')
    expect((await put('source.mp4', mp4)).statusCode).toBe(200)
    const bones = fakeSomaGlb()
    expect((await put('bones.glb', bones)).statusCode).toBe(200)
    const stats = { footSlide: { Left: { medianCmPerSec: 1.0 }, Right: { medianCmPerSec: 2.0 } }, jitterAccMedian: { LeftHand: 1, RightHand: 3 }, lowestPointCm: { median: 0.4 } }
    const rs = await ctx.app.inject({ method: 'PUT', url: '/api/jobs/wave-001/files/stats.json', payload: stats })
    expect(rs.statusCode).toBe(200)
    const out = convertGlb(bones, { from: 0.1, to: 0.9 })
    const vrmaPath = join(dir, 'm.vrma')
    writeVrma(vrmaPath, out)
    const r = await put('motion.vrma', readFileSync(vrmaPath))
    expect(r.statusCode).toBe(200)
    const job = r.json()
    expect(Object.keys(job.files).sort()).toEqual(['bones.glb', 'motion.vrma', 'source.mp4', 'stats.json'])
    expect(job.quality.footSlideCmPerSec).toBe(1.5)
    expect(job.quality.wristJitter).toBe(2)
    expect(job.quality.lowestPointMedianCm).toBe(0.4)
    expect(job.quality.sourceStartSec).toBeCloseTo(0.1, 2)
    expect(job.quality.vrmaSec).toBeGreaterThan(0.7)
    // 置いたファイルはそのまま取れる
    const g = await ctx.app.inject({ method: 'GET', url: '/api/jobs/wave-001/files/bones.glb' })
    expect(g.statusCode).toBe(200)
    expect(g.rawPayload.equals(bones)).toBe(true)
    // まだ焼いていない確認用の動画は 404
    expect((await ctx.app.inject({ method: 'GET', url: '/api/jobs/wave-001/files/compare.mp4' })).statusCode).toBe(404)
  })

  it('id にパスの文字は使えない', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/jobs/..%2F..%2Fetc' })).statusCode).toBe(400)
  })

  it('一覧に出る', async () => {
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/jobs' })).json()
    expect(list.map((j: { id: string }) => j.id).sort()).toEqual(['wave-001', 'wave-002'])
  })
})

describe('設定', () => {
  it('python のパスを書ける（空なら自動で探す）。前後の空白は落とす', async () => {
    const put = await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { gemxPython: '  /opt/py/bin/python  ', comfyuiPython: '' } })
    expect(put.statusCode).toBe(200)
    const s = put.json()
    expect(s.gemxPython).toBe('/opt/py/bin/python')
    expect(s.resolved.gemxPython).toBe(join(resolve('/opt/py/bin'), 'python'))
    expect(s.resolved.gemxPythonFromSettings).toBe(true)
    expect(s.comfyuiPython).toBe('')
    expect(s.resolved.comfyuiPythonFromSettings).toBe(false)
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))
    expect(saved.gemxPython).toBe('/opt/py/bin/python')
    // 依頼の中身の gemx.python にも出る
    const job = (await ctx.app.inject({ method: 'GET', url: '/api/jobs/wave-001' })).json()
    expect(job.gemx.python).toBe(s.resolved.gemxPython)
    expect(job.app.tools.gemx).toBe(join(root, 'tools', 'gemx.mjs'))
    expect(job.app.tools.freeVram).toBe(join(root, 'tools', 'free_vram.mjs'))
  })
})
