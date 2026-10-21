// エージェントが使う道具（tools/*.mjs）が、どのアプリのサーバを見るか（--app・APP_URL）と、依頼文がそれを書くか
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findAppRoot } from '../server/config'
import type { Job } from '../server/shared'
import { requestText } from '../server/texts'

const root = findAppRoot()

/** 道具を動かして、終わりのコードと出力を返す（APP_URL などは env で渡す。既定の 4170 は見に行かせない） */
function runTool(script: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((ok) => {
    const base = { ...process.env }
    for (const k of ['APP_URL', 'GEMX_ROOT', 'GEMX_PYTHON', 'COMFYUI_URL']) delete base[k]
    const p = spawn(process.execPath, [join(root, 'tools', script), ...args], { env: { ...base, ...env }, cwd: root })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => ok({ code, out, err }))
  })
}

/** 偽のアプリ（と ComfyUI）のサーバ。来た要求を覚える */
let server: Server
let url = ''
let seen: string[] = []
let dir = ''
let video = ''
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'h3mc-tools-'))
  video = join(dir, 'source.mp4')
  writeFileSync(video, 'not really a video')
  server = createServer((req: IncomingMessage, res) => {
    seen.push(`${req.method} ${req.url}`)
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/api/settings') {
      res.end(JSON.stringify({ comfyuiUrl: url, resolved: { gemxPath: join(dir, 'no-such-gemx'), gemxPython: null } }))
    } else if (req.url === '/free' && req.method === 'POST') {
      res.end('{}')
    } else {
      res.statusCode = 404
      res.end('{}')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise((r) => server.close(r))
  rmSync(dir, { recursive: true, force: true })
})

describe('道具は --app（無ければ APP_URL）のアプリを見る', () => {
  it('gemx.mjs: --app のアプリの設定から GEM-X を探す（--app は後ろでも前でもよい）', async () => {
    for (const args of [[video, join(dir, 'out'), '--app', url], ['--app', `${url}/`, video, join(dir, 'out')]]) {
      seen = []
      const r = await runTool('gemx.mjs', args)
      expect(r.code).toBe(1)
      expect(seen).toContain('GET /api/settings')
      expect(r.err).toContain(join(dir, 'no-such-gemx'))
      expect(r.err).toContain(url)
    }
  })

  it('gemx.mjs: --app が無ければ環境変数 APP_URL', async () => {
    seen = []
    const r = await runTool('gemx.mjs', [video, join(dir, 'out')], { APP_URL: url })
    expect(r.code).toBe(1)
    expect(seen).toContain('GET /api/settings')
    expect(r.err).toContain(join(dir, 'no-such-gemx'))
  })

  it('gemx.mjs: --app の後に URL が無ければ使い方の誤り（2）', async () => {
    const r = await runTool('gemx.mjs', [video, join(dir, 'out'), '--app'])
    expect(r.code).toBe(2)
  })

  it('free_vram.mjs: --app のアプリの設定の ComfyUI に /free を頼む', async () => {
    seen = []
    const r = await runTool('free_vram.mjs', ['--app', url])
    expect(r.code).toBe(0)
    expect(seen).toEqual(['GET /api/settings', 'POST /free'])
    expect(r.out).toContain(url)
  })

  it('free_vram.mjs: 知らない引数は使い方の誤り（2）', async () => {
    seen = []
    for (const args of [['--nope'], ['--app'], ['--app', url, 'extra']]) {
      const r = await runTool('free_vram.mjs', args, { APP_URL: url })
      expect(r.code).toBe(2)
    }
    expect(seen).toEqual([])
  })

  it('h3_r2v.mjs: --job の依頼を --app のアプリに取りに行く（無ければ APP_URL）', async () => {
    seen = []
    const r1 = await runTool('h3_r2v.mjs', ['--app', url, '--job', 'wave-001', '--prompt', 'x'])
    expect(seen).toContain('GET /api/jobs/wave-001')
    expect(r1.code).toBe(1)
    expect(r1.err).toContain(url)
    seen = []
    const r2 = await runTool('h3_r2v.mjs', ['--job', 'wave-002', '--prompt', 'x'], { APP_URL: url })
    expect(seen).toContain('GET /api/jobs/wave-002')
    expect(r2.code).toBe(1)
  })
})

describe('依頼文', () => {
  it('道具に --app <サーバ> を付けるように書く（既定でないポートでも詰まらない）', () => {
    const job = { id: 'jump-001', modelId: 'm-1', motion: 'ジャンプ', durationSec: 5, aspect: '9:16' } as unknown as Job
    const text = requestText(job, undefined, { serverUrl: 'http://127.0.0.1:4999', appRoot: root })
    expect(text).toContain('node tools/h3_r2v.mjs --app http://127.0.0.1:4999 --job jump-001')
    expect(text).toContain('node tools/free_vram.mjs --app http://127.0.0.1:4999')
    expect(text).toMatch(/node tools\/gemx\.mjs [^\n]*--app http:\/\/127\.0\.0\.1:4999/)
    expect(text).toContain('app.workDir')
  })
})
