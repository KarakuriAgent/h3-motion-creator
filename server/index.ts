// 起動: npm start（ビルド済み）か npm run dev:server。HOST・PORT で待ち受けを変えられる（既定 127.0.0.1:4170）
import { buildApp } from './app.js'
import { findAppRoot } from './config.js'
import { closeBrowser } from './render.js'

const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 4170)
const root = findAppRoot()
const serverUrl = process.env.SERVER_URL ?? `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`

const { app, paths } = await buildApp({ root, dataDir: process.env.DATA_DIR, serverUrl, logger: !!process.env.LOG })
await app.listen({ host, port })
console.log(`[h3-motion-creator] ${serverUrl}（アプリ ${root}・作業データ ${paths.data}）`)
// 起動したらまず環境チェック（結果は GET /api/env?cached=1 で取れる）
app.inject({ method: 'GET', url: '/api/env' }).then(
  (r) => {
    const env = r.json() as { items: { label: string; state: string }[]; ready: boolean }
    console.log(`[h3-motion-creator] 環境チェック: ${env.ready ? 'すべて OK' : `足りない物 ${env.items.filter((i) => i.state === 'missing').map((i) => i.label).join('・')}`}`)
  },
  () => {},
)

const stop = async () => {
  await app.close()
  await closeBrowser()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
