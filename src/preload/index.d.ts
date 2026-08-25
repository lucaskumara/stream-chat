import type { ChatApi } from '@shared/types'

declare global {
  interface Window {
    api?: ChatApi
  }
}

export {}
