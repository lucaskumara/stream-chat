import type { ChatApi } from '@shared/types'

export function bridge(): { api: ChatApi } {
  const api = window.api
  if (!api) throw new Error('stream-chat must run inside the Electron shell')

  return { api }
}
