import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Set VITE_BASE_PATH when deploying under a repository subpath (for example
  // GitHub Pages). Render Static Sites can keep the default `/` base.
  base: process.env.VITE_BASE_PATH || '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:4100', changeOrigin: true } },
  },
  test: { environment: 'jsdom', globals: true },
})
