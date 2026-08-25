import type { ChatApi } from '@shared/types'

declare global {
  interface Window {
    /** Injected by the preload bridge. Absent when the renderer runs in a
     *  plain browser tab for load testing — see renderer/src/bridge.ts. */
    api?: ChatApi
  }
}

export {}
