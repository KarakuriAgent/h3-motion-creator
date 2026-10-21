// ヘッドレスのブラウザ（Playwright の chromium）で three-vrm を描く: 三面図（PNG）と VRM の確認動画（mp4）。
// ページ（render/*.html）とモデルの URL は、このアプリのサーバが配る（serverUrl）。描画は WebGL（GPU が無くても SwiftShader で描ける）
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright-core'
import { commandPath } from './platform.js'

let browserP: Promise<Browser> | null = null

/** 起動の仕方: SwiftShader の WebGL（GPU に依らず同じ絵になる） */
export const CHROMIUM_ARGS = ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

async function browser(): Promise<Browser> {
  if (!browserP) {
    browserP = chromium.launch({ headless: true, args: CHROMIUM_ARGS }).catch((e) => {
      browserP = null
      throw new Error(`chromium を起動できません（npx playwright-core install chromium-headless-shell で入れる）: ${e instanceof Error ? e.message : e}`)
    })
  }
  return browserP
}

export async function closeBrowser(): Promise<void> {
  if (browserP) {
    const b = await browserP.catch(() => null)
    browserP = null
    await b?.close()
  }
}

async function openPage(serverUrl: string, page: string) {
  const b = await browser()
  const ctx = await b.newContext()
  const p = await ctx.newPage()
  const errors: string[] = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await p.goto(`${serverUrl}/render/${page}`)
  await p.waitForFunction(() => (window as any).ready === true, null, { timeout: 60000 })
  return { p, ctx, errors }
}

export interface ThreeViewResult {
  width: number
  height: number
  panelWidth: number
  /** 全身の大きさ [x, y, z] m */
  size: [number, number, number]
}

/** 三面図（正面・右側・後ろを横に並べた 1 枚）を out に書く。armDown = 上腕を水平から下ろす角度（度） */
export async function renderThreeView(serverUrl: string, vrmUrl: string, out: string, opts: { panelH?: number; armDown?: number; bg?: string } = {}): Promise<ThreeViewResult> {
  const { p, ctx, errors } = await openPage(serverUrl, 'threeview.html')
  try {
    const r = (await p.evaluate((a) => (window as any).renderThreeView(a), { vrmUrl, panelH: opts.panelH ?? 1400, armDown: opts.armDown ?? 50, bg: opts.bg ?? '#f2f2f2' })) as {
      png: string
      panelW: number
      panelH: number
      size: [number, number, number]
    }
    writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'))
    return { width: r.panelW * 3, height: r.panelH, panelWidth: r.panelW, size: r.size }
  } catch (e) {
    throw new Error(`三面図を描けません: ${e instanceof Error ? e.message : e}${errors.length ? `（ページ: ${errors.join(' / ')}）` : ''}`)
  } finally {
    await ctx.close()
  }
}

/**
 * VRM に .vrma を載せた確認の動画を out（mp4）に書く。元の動画と同じ時間の軸で撮る:
 * フレーム i（fps）の時刻 = i / fps、.vrma の時刻 = その時刻 - sourceStartSec（.vrma の外は始め・終わりの姿勢で止める）
 */
export async function renderVrmVideo(
  serverUrl: string,
  a: { vrmUrl: string; vrmaUrl: string; out: string; width: number; height: number; fps: number; frames: number; sourceStartSec: number },
): Promise<void> {
  const { p, ctx, errors } = await openPage(serverUrl, 'vrm-video.html')
  const ff = spawn(commandPath('ffmpeg'), ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(a.fps), '-i', '-', '-an', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', a.out], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  })
  let ffErr = ''
  ff.stderr.on('data', (d) => (ffErr += d))
  const done = new Promise<void>((ok, ng) => {
    ff.on('error', (e) => ng(new Error(`ffmpeg を起動できません: ${e.message}`)))
    ff.on('close', (c) => (c === 0 ? ok() : ng(new Error(`ffmpeg が失敗しました: ${ffErr.trim()}`))))
  })
  try {
    await p.evaluate((x) => (window as any).setup(x), { vrmUrl: a.vrmUrl, vrmaUrl: a.vrmaUrl, width: a.width, height: a.height })
    for (let i = 0; i < a.frames; i++) {
      const t = i / a.fps - a.sourceStartSec
      const url = (await p.evaluate(([tt, dt]) => (window as any).frame(tt, dt), [t, i === 0 ? 0 : 1 / a.fps])) as string
      const buf = Buffer.from(url.split(',')[1], 'base64')
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once('drain', ok))
    }
    ff.stdin.end()
    await done
  } catch (e) {
    ff.stdin.destroy()
    ff.kill()
    throw new Error(`VRM の動画を描けません: ${e instanceof Error ? e.message : e}${errors.length ? `（ページ: ${errors.join(' / ')}）` : ''}`)
  } finally {
    await ctx.close()
  }
}
