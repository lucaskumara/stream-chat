import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Tests live outside src, so they reach the app through aliases rather than through
// a stack of ../../.. — see "Path aliases" in CLAUDE.md, which this is one of the
// four homes for. '@main' exists only here and in tsconfig.test.json: nothing under
// src uses it, so the build configs have no reason to know it. Keep the longer keys
// ahead of '@', because Vite matches a string alias by prefix.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
