import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../server/app'
import { findAppRoot } from '../server/config'
import { crumbsOf, isLoopback } from '../server/fs-browse'

const root = findAppRoot()
let data: string
let base: string
let ctx: Awaited<ReturnType<typeof buildApp>>

const get = (path?: string, extra = '') => ctx.app.inject({ method: 'GET', url: `/api/fs/dirs${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}${extra}` })

beforeAll(async () => {
  data = mkdtempSync(join(tmpdir(), 'h3mc-fs-data-'))
  base = mkdtempSync(join(tmpdir(), 'h3mc-fs-'))
  // フォルダ・ファイル・隠しフォルダ・リンク・ComfyUI らしい物・GEM-X らしい物
  mkdirSync(join(base, 'b-plain'))
  mkdirSync(join(base, '.hidden'))
  writeFileSync(join(base, 'file.txt'), 'x')
  mkdirSync(join(base, 'a-comfy/custom_nodes'), { recursive: true })
  writeFileSync(join(base, 'a-comfy/main.py'), '')
  mkdirSync(join(base, 'c-gemx/scripts/demo'), { recursive: true })
  mkdirSync(join(base, 'c-gemx/.venv'))
  symlinkSync(join(base, 'b-plain'), join(base, 'd-link'))
  symlinkSync(join(base, 'file.txt'), join(base, 'e-filelink'))
  symlinkSync(join(base, 'nowhere'), join(base, 'f-broken'))
  mkdirSync(join(base, 'locked'))
  ctx = await buildApp({ root, dataDir: data, render: false })
})
afterAll(async () => {
  await ctx.app.close()
  chmodSync(join(base, 'locked'), 0o755)
  rmSync(base, { recursive: true, force: true })
  rmSync(data, { recursive: true, force: true })
})

describe('GET /api/fs/dirs', () => {
  it('フォルダだけを名前順に返す（ファイル・ファイルへのリンク・切れたリンクは出さない）。リンクのフォルダは出す', async () => {
    const r = await get(base)
    expect(r.statusCode).toBe(200)
    const l = r.json()
    expect(l.path).toBe(base)
    expect(l.parent).toBe(tmpdir())
    expect(l.dirs.map((d: { name: string }) => d.name)).toEqual(['a-comfy', 'b-plain', 'c-gemx', 'd-link', 'locked'])
    expect(l.dirs.find((d: { name: string }) => d.name === 'd-link').link).toBe(true)
    expect(l.hiddenCount).toBe(1)
    expect(l.crumbs.at(-1).path).toBe(base)
  })

  it('隠しフォルダは hidden=1 のときだけ出す', async () => {
    const l = (await get(base, '&hidden=1')).json()
    expect(l.dirs.map((d: { name: string }) => d.name)).toContain('.hidden')
  })

  it('ComfyUI らしい・GEM-X らしいの手がかり', async () => {
    const l = (await get(base)).json()
    const hints = Object.fromEntries(l.dirs.map((d: { name: string; hints: string[] }) => [d.name, d.hints]))
    expect(hints['a-comfy']).toEqual(['comfyui'])
    expect(hints['c-gemx']).toEqual(['gemx'])
    expect(hints['b-plain']).toEqual([])
    expect((await get(join(base, 'a-comfy'))).json().hints).toEqual(['comfyui'])
  })

  it('シンボリックリンクのフォルダの中へもたどれる', async () => {
    const r = await get(join(base, 'd-link'))
    expect(r.statusCode).toBe(200)
  })

  it('省略と ~ はホーム', async () => {
    expect((await get()).json().path).toBe(homedir())
    expect((await get('~')).json().path).toBe(homedir())
  })

  it('読めないときはエラーを文で返す', async () => {
    const missing = await get(join(base, 'nope'))
    expect(missing.statusCode).toBe(404)
    expect(missing.json().error).toContain('フォルダがありません')
    const file = await get(join(base, 'file.txt'))
    expect(file.statusCode).toBe(400)
    expect(file.json().error).toContain('フォルダではありません')
    const rel = await get('relative/path')
    expect(rel.statusCode).toBe(400)
    expect(rel.json().error).toContain('絶対パス')
    chmodSync(join(base, 'locked'), 0o000)
    // root で動かしていると権限があっても読めるので確かめない
    if (process.getuid?.() !== 0) {
      const locked = await get(join(base, 'locked'))
      expect(locked.statusCode).toBe(400)
      expect(locked.json().error).toContain('読めません')
    }
  })

  it('この PC の外からの接続には答えない', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/fs/dirs', remoteAddress: '192.168.1.20' })
    expect(r.statusCode).toBe(403)
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopback('10.0.0.1')).toBe(false)
  })

  it('パンくずはルートから', () => {
    expect(crumbsOf('/a/b').map((c) => [c.name, c.path])).toEqual([
      ['/', '/'],
      ['a', '/a'],
      ['b', '/a/b'],
    ])
  })
})
