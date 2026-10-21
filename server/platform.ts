// 外のコマンドと Python の場所を探す（shell を通さずに起動できる実体のパスを返す）
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export interface LookupOptions {
  /** 既定 process.platform（テストで差し替える） */
  platform?: NodeJS.Platform
  /** 既定 process.env */
  env?: NodeJS.ProcessEnv
  /** そのパスが動かせるファイルか（既定はファイルシステムを見る） */
  isFile?: (p: string) => boolean
}

const pathOf = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32 : path.posix)

function defaultIsFile(platform: NodeJS.Platform): (p: string) => boolean {
  return (p) => {
    try {
      if (!statSync(p).isFile()) return false // シンボリックリンクはたどる（venv の python はリンク）
      if (platform !== 'win32') accessSync(p, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
}

/** フォルダの中の Python の候補（OS ごと。並びの順に探す）。
 * Windows: venv・.venv の Scripts\python.exe と ComfyUI の portable 版の python_embeded\python.exe（フォルダの中か、一つ上に並ぶ物）。
 * ほか: venv・.venv の bin/python（python3） */
export function pythonCandidates(dir: string, platform: NodeJS.Platform = process.platform): string[] {
  const p = pathOf(platform)
  if (platform === 'win32') {
    return [
      p.join(dir, 'venv', 'Scripts', 'python.exe'),
      p.join(dir, '.venv', 'Scripts', 'python.exe'),
      p.join(dir, 'python_embeded', 'python.exe'),
      // portable 版は ComfyUI_windows_portable\ComfyUI と ComfyUI_windows_portable\python_embeded が並ぶ
      p.join(dir, '..', 'python_embeded', 'python.exe'),
    ]
  }
  return [p.join(dir, 'venv', 'bin', 'python'), p.join(dir, '.venv', 'bin', 'python'), p.join(dir, 'venv', 'bin', 'python3'), p.join(dir, '.venv', 'bin', 'python3')]
}

/** フォルダの中の Python を探す。無ければ null */
export function findPython(dir: string, opts: LookupOptions = {}): string | null {
  const platform = opts.platform ?? process.platform
  const isFile = opts.isFile ?? defaultIsFile(platform)
  return pythonCandidates(dir, platform).find((c) => isFile(c)) ?? null
}

/** PATH からコマンドを探す（Windows は .exe・.com を足し、区切りは ;）。パスの区切りを含めばそのパスだけを見る。無ければ null */
export function findOnPath(cmd: string, opts: LookupOptions = {}): string | null {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const isFile = opts.isFile ?? defaultIsFile(platform)
  const p = pathOf(platform)
  const win = platform === 'win32'
  // shell を通さずに起動できる物だけ（.bat・.cmd は shell が要る）
  const exts = win ? (/\.(exe|com)$/i.test(cmd) ? [''] : ['.exe', '.com']) : ['']
  const hasSep = win ? /[\\/]/.test(cmd) : cmd.includes('/')
  if (hasSep) return exts.map((e) => cmd + e).find((c) => isFile(c)) ?? null
  // Windows の環境変数の名前は大文字小文字を問わない（Path のことが多い）
  const key = win ? (Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH') : 'PATH'
  const dirs = String(env[key] ?? '')
    .split(win ? ';' : ':')
    .map((d) => (win ? d.replace(/^"(.*)"$/, '$1') : d))
    .filter(Boolean)
  for (const d of dirs) {
    for (const e of exts) {
      const c = p.join(d, cmd + e)
      if (isFile(c)) return c
    }
  }
  return null
}

/** 起動に使う名前（PATH で見つかればその実体、無ければ名前のまま。起動の失敗は ENOENT になる） */
export function commandPath(cmd: string): string {
  return findOnPath(cmd) ?? cmd
}

/** `~`・`~/…`・`~\…` をホームに広げる */
export function expandHome(v: string, home: string = homedir()): string {
  if (v === '~') return home
  if (v.startsWith('~/') || v.startsWith('~\\')) return path.join(home, v.slice(2))
  return v
}

/** ffmpeg・ffprobe の入れ方の例（OS ごと） */
export function ffmpegInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'winget install Gyan.FFmpeg など。入れたら PATH が通った新しい端末でサーバを起動し直す'
  if (platform === 'darwin') return 'brew install ffmpeg など'
  return 'sudo apt install ffmpeg など。sudo が要るなら人に頼む'
}

/** Python を子のプロセスで動かすときの環境変数（入出力とファイルを UTF-8 にそろえる） */
export function pythonEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...extra }
}
