import type { Platform } from './types'

/**
 * How a channel was named. The three platforms are not symmetric: Twitch and
 * Kick attach chat to a *channel*, while YouTube attaches it to a *live video*,
 * so a YouTube reference can be either a channel or a specific broadcast.
 */
export type ChannelRefKind =
  | 'twitch-login'
  | 'youtube-handle'
  | 'youtube-channel-id'
  | 'youtube-video-id'
  | 'kick-slug'

export interface ChannelRef {
  platform: Platform
  kind: ChannelRefKind
  /** Canonical identifier: lowercased login/slug, or the exact YouTube id. */
  value: string
  /** What to show before the provider resolves a display name. */
  label: string
}

export interface ParseResult {
  ok: boolean
  ref?: ChannelRef
  error?: string
  /** True when the text is a bare name and the caller must supply a platform. */
  needsPlatform?: boolean
}

const TWITCH_LOGIN = /^[a-z0-9_]{3,25}$/
const KICK_SLUG = /^[a-z0-9_-]{2,25}$/
const YT_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const YT_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/
const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function ref(platform: Platform, kind: ChannelRefKind, value: string, label = value): ChannelRef {
  return { platform, kind, value, label }
}

/** Pull a URL apart when the user pasted a link rather than typing a name. */
function parseUrl(raw: string): ParseResult | null {
  let url: URL
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === 'twitch.tv' || host === 'm.twitch.tv') {
    // /popout/<login>/chat and /<login>/... both appear in pasted links.
    const login = (segments[0] === 'popout' ? segments[1] : segments[0])?.toLowerCase()
    if (!login) return { ok: false, error: 'That Twitch link has no channel name in it.' }
    if (!TWITCH_LOGIN.test(login)) return { ok: false, error: `"${login}" is not a valid Twitch channel.` }
    return { ok: true, ref: ref('twitch', 'twitch-login', login) }
  }

  if (host === 'kick.com') {
    const slug = segments[0]?.toLowerCase()
    if (!slug) return { ok: false, error: 'That Kick link has no channel name in it.' }
    if (!KICK_SLUG.test(slug)) return { ok: false, error: `"${slug}" is not a valid Kick channel.` }
    return { ok: true, ref: ref('kick', 'kick-slug', slug) }
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    // Chat lives on a video, so a watch link is the most precise thing to get.
    if (host === 'youtu.be') {
      const id = segments[0]
      if (id && YT_VIDEO_ID.test(id)) return { ok: true, ref: ref('youtube', 'youtube-video-id', id) }
      return { ok: false, error: 'That YouTube link has no video id in it.' }
    }

    const videoId = url.searchParams.get('v')
    if (videoId && YT_VIDEO_ID.test(videoId)) {
      return { ok: true, ref: ref('youtube', 'youtube-video-id', videoId) }
    }
    if (segments[0] === 'live' && segments[1] && YT_VIDEO_ID.test(segments[1])) {
      return { ok: true, ref: ref('youtube', 'youtube-video-id', segments[1]) }
    }
    if (segments[0]?.startsWith('@') && YT_HANDLE.test(segments[0])) {
      return { ok: true, ref: ref('youtube', 'youtube-handle', segments[0]) }
    }
    if (segments[0] === 'channel' && segments[1] && YT_CHANNEL_ID.test(segments[1])) {
      return { ok: true, ref: ref('youtube', 'youtube-channel-id', segments[1]) }
    }
    return { ok: false, error: 'Could not find a channel or video in that YouTube link.' }
  }

  return null
}

/**
 * Single entry point for the "add a channel" box. Accepts a pasted URL, a
 * bare name, or `platform:name`. When a bare name is ambiguous the caller is
 * told to supply the platform rather than being guessed at.
 */
export function parseChannelInput(input: string, platformHint?: Platform): ParseResult {
  const raw = input.trim()
  if (raw === '') return { ok: false, error: 'Enter a channel name or paste a link.' }

  if (/^[a-z]+\.[a-z]/i.test(raw) || raw.startsWith('http')) {
    const fromUrl = parseUrl(raw)
    if (fromUrl) return fromUrl
  }

  // `twitch:xqc` style, handy for typing without touching the dropdown.
  const prefixed = raw.match(/^(twitch|youtube|kick)\s*[:/]\s*(.+)$/i)
  if (prefixed) {
    return parseChannelInput(prefixed[2] as string, prefixed[1]?.toLowerCase() as Platform)
  }

  const name = raw.replace(/^@?/, (m) => m) // keep a leading @ for YouTube handles

  // A YouTube handle or channel id identifies itself without a hint.
  if (YT_CHANNEL_ID.test(name)) return { ok: true, ref: ref('youtube', 'youtube-channel-id', name) }
  if (name.startsWith('@') && YT_HANDLE.test(name)) {
    return { ok: true, ref: ref('youtube', 'youtube-handle', name) }
  }

  if (!platformHint || platformHint === 'mock') {
    return { ok: false, needsPlatform: true, error: 'Pick a platform, or paste the channel link.' }
  }

  const lower = name.toLowerCase()
  switch (platformHint) {
    case 'twitch':
      if (!TWITCH_LOGIN.test(lower)) {
        return { ok: false, error: `"${name}" is not a valid Twitch channel name.` }
      }
      return { ok: true, ref: ref('twitch', 'twitch-login', lower) }

    case 'kick':
      if (!KICK_SLUG.test(lower)) {
        return { ok: false, error: `"${name}" is not a valid Kick channel name.` }
      }
      return { ok: true, ref: ref('kick', 'kick-slug', lower) }

    case 'youtube':
      if (YT_VIDEO_ID.test(name)) {
        return { ok: true, ref: ref('youtube', 'youtube-video-id', name) }
      }
      return {
        ok: false,
        error: 'For YouTube, use an @handle, a channel id, or paste the live video link.'
      }

    default:
      return { ok: false, error: `Unsupported platform: ${platformHint}` }
  }
}

/** Where auto-connect is free versus quota-metered, for honest UI labelling. */
export const AUTO_CONNECT_COST: Record<Platform, 'push' | 'polled' | 'none'> = {
  twitch: 'push',
  kick: 'push',
  youtube: 'polled',
  mock: 'none'
}
