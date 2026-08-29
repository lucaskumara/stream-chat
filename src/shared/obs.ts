import { PLATFORMS } from './types'
import type { ChatBatch, ChatMessage, Platform, SourceState } from './types'

export const OBS_PORT = 4568

export const OBS_PORT_ATTEMPTS = 10

export const OBS_SOCKET_PATH = '/socket'

export const OBS_CHAT_PREFIX = '/chat/'

function bareIdentifier(identifier: string): string {
  const trimmed = identifier.trim()

  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
}

/** Matching only. Never send this to a platform — YouTube channel ids and video ids
    are case-sensitive, which is why normalizeIdentifier in sources.ts lowercases
    Twitch and Kick alone. Both sides of a URL comparison are already resolved, so
    folding case and dropping the handle's @ here is safe and makes the link
    typeable without one. */
export function obsMatchKey(identifier: string): string {
  return bareIdentifier(identifier).toLowerCase()
}

export function obsChatPath(platform: Platform, identifier: string): string {
  return `${OBS_CHAT_PREFIX}${platform}/${encodeURIComponent(bareIdentifier(identifier))}`
}

export interface ObsTarget {
  platform: Platform
  key: string
}

/** `/chat/<platform>/<key>` — the path the dock page is served at, and the only
    place the target is spelled out. The page reads its own location rather than
    being handed the target, so one URL is the whole contract. */
export function parseObsChatPath(pathname: string): ObsTarget | null {
  if (!pathname.startsWith(OBS_CHAT_PREFIX)) return null

  const parts = pathname.slice(OBS_CHAT_PREFIX.length).split('/')
  if (parts.length !== 2) return null

  const platform = PLATFORMS.find((candidate) => candidate === parts[0])
  if (!platform) return null

  const key = obsMatchKey(decodeURIComponent(parts[1]))
  if (key === '') return null

  return { platform, key }
}

export type ObsFrame =
  | { type: 'sync'; source: SourceState | null; messages: ChatMessage[] }
  | { type: 'status'; source: SourceState }
  | { type: 'batch'; batch: ChatBatch }
