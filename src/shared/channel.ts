import type { Platform } from './types'

export type ChannelRefKind =
  | 'twitch-login'
  | 'youtube-handle'
  | 'youtube-channel-id'
  | 'youtube-video-id'
  | 'kick-slug'

export interface ChannelRef {
  platform: Platform
  kind: ChannelRefKind

  value: string

  label: string
}

export interface ParseResult {
  ok: boolean
  ref?: ChannelRef
  error?: string

  needsPlatform?: boolean
}

const TWITCH_LOGIN = /^[a-z0-9_]{3,25}$/
const KICK_SLUG = /^[a-z0-9_-]{2,25}$/
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const YOUTUBE_HANDLE = /^@[A-Za-z0-9._-]{3,30}$/
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const PLATFORM_PREFIX = /^(twitch|youtube|kick)\s*[:/]\s*(.+)$/i

const LOOKS_LIKE_URL = /^[a-z]+\.[a-z]|^http/i

function ok(platform: Platform, kind: ChannelRefKind, value: string): ParseResult {
  return { ok: true, ref: { platform, kind, value, label: value } }
}

function fail(error: string): ParseResult {
  return { ok: false, error }
}

function parseTwitchUrl(segments: string[]): ParseResult {
  const login = (segments[0] === 'popout' ? segments[1] : segments[0])?.toLowerCase()
  if (!login) return fail('That Twitch link has no channel name in it.')
  if (!TWITCH_LOGIN.test(login)) return fail(`"${login}" is not a valid Twitch channel.`)
  return ok('twitch', 'twitch-login', login)
}

function parseKickUrl(segments: string[]): ParseResult {
  const slug = segments[0]?.toLowerCase()
  if (!slug) return fail('That Kick link has no channel name in it.')
  if (!KICK_SLUG.test(slug)) return fail(`"${slug}" is not a valid Kick channel.`)
  return ok('kick', 'kick-slug', slug)
}

function parseYouTubeUrl(url: URL, segments: string[], isShortLink: boolean): ParseResult {
  if (isShortLink) {
    const videoId = segments[0]
    if (videoId && YOUTUBE_VIDEO_ID.test(videoId)) {
      return ok('youtube', 'youtube-video-id', videoId)
    }
    return fail('That YouTube link has no video id in it.')
  }

  const watchId = url.searchParams.get('v')
  if (watchId && YOUTUBE_VIDEO_ID.test(watchId)) {
    return ok('youtube', 'youtube-video-id', watchId)
  }
  if (segments[0] === 'live' && segments[1] && YOUTUBE_VIDEO_ID.test(segments[1])) {
    return ok('youtube', 'youtube-video-id', segments[1])
  }
  if (segments[0]?.startsWith('@') && YOUTUBE_HANDLE.test(segments[0])) {
    return ok('youtube', 'youtube-handle', segments[0])
  }
  if (segments[0] === 'channel' && segments[1] && YOUTUBE_CHANNEL_ID.test(segments[1])) {
    return ok('youtube', 'youtube-channel-id', segments[1])
  }
  return fail('Could not find a channel or video in that YouTube link.')
}

function parseUrl(raw: string): ParseResult | null {
  let url: URL
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (host === 'twitch.tv' || host === 'm.twitch.tv') return parseTwitchUrl(segments)
  if (host === 'kick.com') return parseKickUrl(segments)
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    return parseYouTubeUrl(url, segments, false)
  }
  if (host === 'youtu.be') return parseYouTubeUrl(url, segments, true)

  return null
}

function parseSelfDescribingName(name: string): ParseResult | null {
  if (YOUTUBE_CHANNEL_ID.test(name)) return ok('youtube', 'youtube-channel-id', name)
  if (name.startsWith('@') && YOUTUBE_HANDLE.test(name)) {
    return ok('youtube', 'youtube-handle', name)
  }
  return null
}

function parseBareName(name: string, platform: Platform): ParseResult {
  const lower = name.toLowerCase()

  switch (platform) {
    case 'twitch':
      return TWITCH_LOGIN.test(lower)
        ? ok('twitch', 'twitch-login', lower)
        : fail(`"${name}" is not a valid Twitch channel name.`)

    case 'kick':
      return KICK_SLUG.test(lower)
        ? ok('kick', 'kick-slug', lower)
        : fail(`"${name}" is not a valid Kick channel name.`)

    case 'youtube':
      return YOUTUBE_VIDEO_ID.test(name)
        ? ok('youtube', 'youtube-video-id', name)
        : fail('For YouTube, use an @handle, a channel id, or paste the live video link.')

    default:
      return fail(`Unsupported platform: ${platform}`)
  }
}

export function parseChannelInput(input: string, platformHint?: Platform): ParseResult {
  const raw = input.trim()
  if (raw === '') return fail('Enter a channel name or paste a link.')

  if (LOOKS_LIKE_URL.test(raw)) {
    const fromUrl = parseUrl(raw)
    if (fromUrl) return fromUrl
  }

  const prefixed = raw.match(PLATFORM_PREFIX)
  if (prefixed) {
    return parseChannelInput(prefixed[2] as string, prefixed[1]?.toLowerCase() as Platform)
  }

  const selfDescribing = parseSelfDescribingName(raw)
  if (selfDescribing) return selfDescribing

  if (!platformHint || platformHint === 'mock') {
    return { ok: false, needsPlatform: true, error: 'Pick a platform, or paste the channel link.' }
  }

  return parseBareName(raw, platformHint)
}

export const AUTO_CONNECT_COST: Record<Platform, 'push' | 'polled' | 'none'> = {
  twitch: 'push',
  kick: 'push',
  youtube: 'polled',
  mock: 'none'
}
