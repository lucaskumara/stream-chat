import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PACKAGED_CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"

function packagedCsp(): Plugin {
  return {
    name: 'packaged-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /<meta[^>]*Content-Security-Policy[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="${PACKAGED_CSP}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), tailwindcss(), packagedCsp()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})
