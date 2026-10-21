// フォルダを選ぶダイアログのためにサーバの側のフォルダを見て回る（GET /api/fs/dirs）。読むだけで、作る・消す・書くはしない
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import type { DirListing, FolderHint } from './shared.js'
import { BadRequest, NotFound } from './store.js'

/** 一覧に出すフォルダの数の上限（多すぎるフォルダで画面が重くならないように） */
export const MAX_DIRS = 2000

/** フォルダの中を見て、ComfyUI らしい（main.py と custom_nodes/）・GEM-X らしい（.venv と scripts/demo/）かを返す */
export function folderHints(dir: string): FolderHint[] {
  const out: FolderHint[] = []
  if (existsSync(join(dir, 'main.py')) && isDir(join(dir, 'custom_nodes'))) out.push('comfyui')
  if (existsSync(join(dir, '.venv')) && isDir(join(dir, 'scripts', 'demo'))) out.push('gemx')
  return out
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory() // シンボリックリンクはたどる
  } catch {
    return false
  }
}

/** `~`・`~/…` をホームに広げ、絶対パスにそろえる。空ならホーム */
export function normalizeDirPath(raw: string | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s || s === '~') return homedir()
  const expanded = s.startsWith('~/') || s.startsWith('~\\') ? join(homedir(), s.slice(2)) : s
  if (!isAbsolute(expanded)) throw new BadRequest(`絶対パスで書いてください（~ も使えます）: ${s}`)
  return resolve(expanded)
}

/** ルートの並び（Windows ならあるドライブ、ほかは /） */
export function fsRoots(): string[] {
  if (process.platform !== 'win32') return ['/']
  const out: string[] = []
  for (let c = 65; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`
    if (existsSync(d)) out.push(d)
  }
  return out
}

/** パンくず（ルートから今のフォルダまで） */
export function crumbsOf(path: string): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = []
  let cur = path
  for (;;) {
    const parent = dirname(cur)
    if (parent === cur) {
      out.unshift({ name: parse(cur).root || cur, path: cur })
      return out
    }
    out.unshift({ name: cur.slice(parent.length).replace(/^[\\/]+/, ''), path: cur })
    cur = parent
  }
}

function readError(e: unknown, path: string): Error {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return new NotFound(`フォルダがありません: ${path}`)
  if (code === 'ENOTDIR') return new BadRequest(`フォルダではありません: ${path}`)
  if (code === 'EACCES' || code === 'EPERM') return new BadRequest(`このフォルダは読めません（読む権限がありません）: ${path}`)
  return new BadRequest(`このフォルダは読めません（${code ?? (e instanceof Error ? e.message : String(e))}）: ${path}`)
}

/** フォルダの中のフォルダだけを並べる（ファイルは返さない）。隠しフォルダ（. で始まる）は hidden が true のときだけ */
export function listDirs(raw: string | undefined, opts: { hidden?: boolean } = {}): DirListing {
  const path = normalizeDirPath(raw)
  let st
  try {
    st = statSync(path)
  } catch (e) {
    throw readError(e, path)
  }
  if (!st.isDirectory()) throw new BadRequest(`フォルダではありません: ${path}`)
  let entries: Dirent[]
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch (e) {
    throw readError(e, path)
  }
  const dirs: DirListing['dirs'] = []
  let hiddenCount = 0
  for (const ent of entries) {
    const full = join(path, ent.name)
    const link = ent.isSymbolicLink()
    if (!(ent.isDirectory() || (link && isDir(full)))) continue
    if (ent.name.startsWith('.')) {
      hiddenCount++
      if (!opts.hidden) continue
    }
    dirs.push({ name: ent.name, path: full, ...(link ? { link: true } : {}), hints: [] })
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  const truncated = dirs.length > MAX_DIRS
  const shown = truncated ? dirs.slice(0, MAX_DIRS) : dirs
  for (const d of shown) d.hints = folderHints(d.path)
  const parent = dirname(path)
  return {
    path,
    parent: parent === path ? null : parent,
    sep,
    home: homedir(),
    roots: fsRoots(),
    crumbs: crumbsOf(path),
    hints: folderHints(path),
    dirs: shown,
    hiddenCount,
    truncated,
  }
}

/** ループバック（この PC の中）からの接続か */
export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.')
}
