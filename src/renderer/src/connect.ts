import type { Platform } from '@shared/types'
import { parseChannelInput, type ParseResult } from '@shared/channel'
import { PLATFORM_NAME } from './theme'

export const CONNECT_PLACEHOLDER: Record<Platform, string> = {
  twitch: 'channel name, or paste a twitch.tv link',
  youtube: '@handle, channel id, or paste a live link',
  kick: 'channel name, or paste a kick.com link'
}

export const CONNECT_HINT: Record<Platform, string> = {
  twitch: 'Chat is read anonymously — no sign-in needed.',
  youtube: 'The channel has to be live, with chat turned on.',
  kick: 'Chat is readable whether or not the channel is live.'
}

/** Each tab is bound to one platform, so input that resolves elsewhere is refused
    rather than silently connecting on the tab next door — a pasted youtube.com link
    on the Kick tab parses fine, and would otherwise open a chat nobody asked for. */
export function parseForPlatform(input: string, platform: Platform): ParseResult {
  const parsed = parseChannelInput(input, platform)
  if (!parsed.ok || !parsed.ref) return parsed
  if (parsed.ref.platform === platform) return parsed

  const named = PLATFORM_NAME[parsed.ref.platform]

  return { ok: false, error: `That is a ${named} channel — open the ${named} tab for it.` }
}
