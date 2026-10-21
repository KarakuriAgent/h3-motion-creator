// アプリの置き場・作業データの置き場・設定（data/settings.json）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Settings } from './shared.js'

/** アプリの根（このリポジトリ）。dist/server/server/ から動いても、server/ から動いても同じ所を指す */
export function findAppRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'workflows'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

export const DEFAULT_SETTINGS: Settings = { comfyuiPath: '', comfyuiUrl: 'http://127.0.0.1:8188', gemxPath: '' }

export interface Paths {
  /** アプリの根 */
  root: string
  /** 作業データの根（data/。git の外） */
  data: string
  models: string
  jobs: string
  compare: string
  settingsFile: string
}

export function makePaths(root: string, dataDir?: string): Paths {
  const data = resolve(dataDir ?? join(root, 'data'))
  return { root, data, models: join(data, 'models'), jobs: join(data, 'jobs'), compare: join(data, 'compare'), settingsFile: join(data, 'settings.json') }
}

export function ensureDirs(p: Paths): void {
  for (const d of [p.data, p.models, p.jobs, p.compare]) mkdirSync(d, { recursive: true })
}

export function loadSettings(p: Paths): Settings {
  if (!existsSync(p.settingsFile)) return { ...DEFAULT_SETTINGS }
  try {
    const raw = JSON.parse(readFileSync(p.settingsFile, 'utf8'))
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...raw })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** 前後の空白を取り、URL の末尾の / を落とす。URL が空なら既定 */
export function normalizeSettings(s: Settings): Settings {
  const url = String(s.comfyuiUrl ?? '').trim().replace(/\/+$/, '')
  return { comfyuiPath: String(s.comfyuiPath ?? '').trim(), comfyuiUrl: url || DEFAULT_SETTINGS.comfyuiUrl, gemxPath: String(s.gemxPath ?? '').trim() }
}

export function saveSettings(p: Paths, s: Settings): Settings {
  const n = normalizeSettings(s)
  mkdirSync(dirname(p.settingsFile), { recursive: true })
  writeFileSync(p.settingsFile, JSON.stringify(n, null, 2) + '\n')
  return n
}

/** 設定のパス（空なら vendor/ の物）。~ はホームに広げる */
export function resolveTools(root: string, s: Settings) {
  const expand = (v: string) => (v.startsWith('~/') ? join(process.env.HOME ?? '', v.slice(2)) : v)
  const comfyuiPath = s.comfyuiPath ? resolve(expand(s.comfyuiPath)) : join(root, 'vendor/ComfyUI')
  const gemxPath = s.gemxPath ? resolve(expand(s.gemxPath)) : join(root, 'vendor/GEM-X')
  return {
    comfyuiPath,
    comfyuiPathFromSettings: !!s.comfyuiPath,
    gemxPath,
    gemxPathFromSettings: !!s.gemxPath,
    gemxPython: join(gemxPath, '.venv/bin/python'),
  }
}
