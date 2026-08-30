import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// A third place the aliases are spelled — see "Path aliases are declared twice"
// in CLAUDE.md, which is now three. Keep this in step with electron.vite.config.ts
// and the two tsconfigs, and keep '@shared' ahead of '@' so the longer key wins.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
