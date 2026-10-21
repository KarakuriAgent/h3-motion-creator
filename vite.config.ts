import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 画面（web/）。開発中は /api をアプリのサーバ（4170）へ渡す。ビルドした物は dist/web に置き、サーバが配る
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4170' } },
})
