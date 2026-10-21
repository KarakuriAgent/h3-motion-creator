import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resolveTools } from '../server/config'
import { expandHome, findOnPath, findPython, pythonCandidates } from '../server/platform'

/** あるファイルだけを「ある」とする isFile */
const only = (...files: string[]) => (p: string) => files.includes(p)

describe('Python の場所を OS ごとに探す', () => {
  it('win32: venv・.venv の Scripts\\python.exe と python_embeded\\python.exe', () => {
    const c = pythonCandidates('C:\\ai\\ComfyUI', 'win32')
    expect(c).toEqual(['C:\\ai\\ComfyUI\\venv\\Scripts\\python.exe', 'C:\\ai\\ComfyUI\\.venv\\Scripts\\python.exe', 'C:\\ai\\ComfyUI\\python_embeded\\python.exe', 'C:\\ai\\python_embeded\\python.exe'])
    expect(c.some((p) => p.includes('/') || p.includes('bin'))).toBe(false)
  })

  it('win32: portable 版（ComfyUI_windows_portable\\ComfyUI の一つ上の python_embeded）を見つける', () => {
    const py = 'D:\\ComfyUI_windows_portable\\python_embeded\\python.exe'
    expect(findPython('D:\\ComfyUI_windows_portable\\ComfyUI', { platform: 'win32', isFile: only(py) })).toBe(py)
  })

  it('win32: 空白の入ったパスもそのまま', () => {
    const py = 'C:\\Program Files\\GEM X\\.venv\\Scripts\\python.exe'
    expect(findPython('C:\\Program Files\\GEM X', { platform: 'win32', isFile: only(py) })).toBe(py)
  })

  it.each(['linux', 'darwin'] as const)('%s: venv・.venv の bin/python（python3 も）', (platform) => {
    expect(pythonCandidates('/opt/ComfyUI', platform)).toEqual(['/opt/ComfyUI/venv/bin/python', '/opt/ComfyUI/.venv/bin/python', '/opt/ComfyUI/venv/bin/python3', '/opt/ComfyUI/.venv/bin/python3'])
    expect(findPython('/opt/gemx', { platform, isFile: only('/opt/gemx/.venv/bin/python3') })).toBe('/opt/gemx/.venv/bin/python3')
    // Windows の置き場は見ない
    expect(findPython('/opt/gemx', { platform, isFile: only('/opt/gemx/.venv/Scripts/python.exe') })).toBeNull()
  })

  it('venv が先・.venv が後（両方あれば venv）', () => {
    expect(findPython('/x', { platform: 'linux', isFile: only('/x/venv/bin/python', '/x/.venv/bin/python') })).toBe('/x/venv/bin/python')
  })

  it('設定の python があれば探さずにそれを使う。無ければフォルダの中を探す', () => {
    const root = path.resolve('/app')
    const s = { ...DEFAULT_SETTINGS, comfyuiPath: '/c', gemxPath: '/g', gemxPython: '/conda/envs/gemx/bin/python' }
    const t = resolveTools(root, s, { isFile: only(path.join(path.resolve('/c'), 'venv', 'bin', 'python'), path.join(path.resolve('/c'), 'venv', 'Scripts', 'python.exe')) })
    expect(t.gemxPython).toBe(path.resolve('/conda/envs/gemx/bin/python'))
    expect(t.gemxPythonFromSettings).toBe(true)
    expect(t.comfyuiPython).toBe(path.join(path.resolve('/c'), 'venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'))
    expect(t.comfyuiPythonFromSettings).toBe(false)
  })
})

describe('PATH からコマンドを探す', () => {
  it('win32: ; で区切り、.exe を足す。Path の名前は大文字小文字を問わない。引用符を外す', () => {
    const env = { Path: 'C:\\Windows\\System32;"C:\\Program Files\\ffmpeg\\bin";;C:\\tools' }
    const isFile = only('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\tools\\ffprobe.exe', 'C:\\tools\\git.cmd')
    expect(findOnPath('ffmpeg', { platform: 'win32', env, isFile })).toBe('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')
    expect(findOnPath('ffprobe', { platform: 'win32', env, isFile })).toBe('C:\\tools\\ffprobe.exe')
    expect(findOnPath('ffmpeg.exe', { platform: 'win32', env, isFile })).toBe('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')
    // .cmd は shell を通さないと動かないので拾わない
    expect(findOnPath('git', { platform: 'win32', env, isFile })).toBeNull()
  })

  it('win32: 拡張子の無いファイルは拾わない', () => {
    expect(findOnPath('ffmpeg', { platform: 'win32', env: { PATH: 'C:\\bin' }, isFile: only('C:\\bin\\ffmpeg') })).toBeNull()
  })

  it.each(['linux', 'darwin'] as const)('%s: : で区切り、名前のまま', (platform) => {
    const env = { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin' }
    const isFile = only('/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/bin/nvidia-smi')
    expect(findOnPath('ffmpeg', { platform, env, isFile })).toBe('/opt/homebrew/bin/ffmpeg')
    expect(findOnPath('nvidia-smi', { platform, env, isFile })).toBe('/usr/bin/nvidia-smi')
    expect(findOnPath('ffprobe', { platform, env, isFile })).toBeNull()
    expect(findOnPath('ffmpeg.exe', { platform, env, isFile })).toBeNull()
  })

  it('パスの区切りを含めばそのパスだけを見る', () => {
    expect(findOnPath('/usr/bin/ffmpeg', { platform: 'linux', env: { PATH: '' }, isFile: only('/usr/bin/ffmpeg') })).toBe('/usr/bin/ffmpeg')
    expect(findOnPath('C:\\ff\\ffmpeg', { platform: 'win32', env: {}, isFile: only('C:\\ff\\ffmpeg.exe') })).toBe('C:\\ff\\ffmpeg.exe')
  })

  it('PATH が無くても落ちない', () => {
    expect(findOnPath('ffmpeg', { platform: 'linux', env: {}, isFile: () => true })).toBeNull()
  })

  it('この OS で本当に探せる（node 自身）', () => {
    const node = findOnPath(path.basename(process.execPath).replace(/\.exe$/i, ''), { env: { PATH: path.dirname(process.execPath) } })
    expect(node).toBe(process.execPath)
  })
})

describe('~ をホームに広げる', () => {
  it('~・~/・~\\', () => {
    expect(expandHome('~', '/home/u')).toBe('/home/u')
    expect(expandHome('~/ComfyUI', '/home/u')).toBe(path.join('/home/u', 'ComfyUI'))
    expect(expandHome('~\\ComfyUI', '/home/u')).toBe(path.join('/home/u', 'ComfyUI'))
    expect(expandHome('/abs/~x', '/home/u')).toBe('/abs/~x')
  })
})
