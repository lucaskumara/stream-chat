import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const PACKAGED_CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'"

// The dock page is served over http by the link server and talks to it over a
// WebSocket, so it keeps a connect-src the app does not need. Loopback only.
const OBS_PACKAGED_CSP =
  "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src ws://127.0.0.1:* ws://localhost:*; object-src 'none'; " +
  "base-uri 'none'; frame-src 'none'"

function packagedCsp(): Plugin {
  return {
    name: 'packaged-csp',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      const csp = ctx.filename.endsWith('obs.html') ? OBS_PACKAGED_CSP : PACKAGED_CSP

      return html.replace(
        /<meta[^>]*Content-Security-Policy[^>]*>/,
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
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
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          obs: resolve('src/renderer/obs.html')
        }
      }
    }
  }
})
