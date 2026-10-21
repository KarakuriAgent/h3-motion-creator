import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 画面（web/）。開発中は /api をアプリのサーバ（4170）へ渡す。ビルドした物は dist/web に置き、サーバが配る。
// base は相対（./assets/…）にして、パスの前置きのあるプロキシ越し（Colab のポートの転送など）でも読めるようにする
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4170' } },
})
