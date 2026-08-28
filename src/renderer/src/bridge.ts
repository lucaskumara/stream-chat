import type { ChatApi } from '@shared/types'

export function bridge(): { api: ChatApi } {
  const api = window.api
  if (!api) throw new Error('stream-chat must run inside the Electron shell')

  return { api }
}

const REMOTE_WRAPPER = /^Error invoking remote method '[^']*':[ ]*(?:Error:[ ]*)?/

export function remoteMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)

  return raw.replace(REMOTE_WRAPPER, '')
}
