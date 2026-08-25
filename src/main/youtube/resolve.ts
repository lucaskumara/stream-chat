import {
  extractInitialJson,
  fetchPage,
  readClient,
  readContinuation,
  YOUTUBE_ORIGIN,
  type InnertubeClient
} from './innertube'
import type { YtInitialData, YtLiveChatRenderer, YtPlayerResponse } from './types'

export type YouTubeRefKind = 'handle' | 'channel-id' | 'video-id'

export interface YouTubeRef {
  kind: YouTubeRefKind
  value: string
}

export interface LiveChatSession {
  client: InnertubeClient
  continuation: string
  videoId: string
  channelId: string
  author: string
  title: string
}

export type ResolveOutcome =
  | { state: 'live'; session: LiveChatSession }
  | { state: 'offline'; message: string }
  | { state: 'missing'; message: string }
  | { state: 'unreachable'; message: string }

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const UNFILTERED_VIEW = 'Live chat'

export function classifyIdentifier(identifier: string): YouTubeRef {
  const value = identifier.trim()
  if (value.startsWith('@')) return { kind: 'handle', value }
  if (CHANNEL_ID.test(value)) return { kind: 'channel-id', value }
  if (VIDEO_ID.test(value)) return { kind: 'video-id', value }
  return { kind: 'handle', value: `@${value}` }
}

function pageUrl(ref: YouTubeRef): string {
  switch (ref.kind) {
    case 'handle':
      return `${YOUTUBE_ORIGIN}/${encodeURIComponent(ref.value)}/live`
    case 'channel-id':
      return `${YOUTUBE_ORIGIN}/channel/${encodeURIComponent(ref.value)}/live`
    case 'video-id':
      return `${YOUTUBE_ORIGIN}/watch?v=${encodeURIComponent(ref.value)}`
  }
}

export async function resolveLiveChat(ref: YouTubeRef): Promise<ResolveOutcome> {
  let page: Awaited<ReturnType<typeof fetchPage>>
  try {
    page = await fetchPage(pageUrl(ref))
  } catch (error) {
    return { state: 'unreachable', message: reason(error) }
  }

  if (page.status === 404) return { state: 'missing', message: describeMissing(ref) }
  if (page.status !== 200) {
    return { state: 'unreachable', message: `YouTube returned ${page.status}` }
  }

  const offline = checkLive(page.html)
  if (offline) return offline

  const watchRenderer =
    extractInitialJson<YtInitialData>(page.html, 'ytInitialData')?.contents
      ?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer
  const fallback = readContinuation(watchRenderer?.continuations)?.token
  if (!fallback) return { state: 'offline', message: 'live chat is turned off for this stream' }

  const details = extractInitialJson<YtPlayerResponse>(page.html, 'ytInitialPlayerResponse')
    ?.videoDetails
  const videoId = details?.videoId ?? ''

  return {
    state: 'live',
    session: {
      client: readClient(page.html),
      continuation: (await fetchUnfilteredContinuation(videoId)) ?? fallback,
      videoId,
      channelId: details?.channelId ?? '',
      author: details?.author ?? '',
      title: details?.title ?? ''
    }
  }
}

function checkLive(html: string): ResolveOutcome | null {
  const player = extractInitialJson<YtPlayerResponse>(html, 'ytInitialPlayerResponse')
  if (!player?.videoDetails) return { state: 'offline', message: 'not streaming right now' }
  if (player.videoDetails.isLive !== true) {
    return { state: 'offline', message: 'not streaming right now' }
  }

  const playability = player.playabilityStatus
  if (playability?.status && playability.status !== 'OK') {
    return { state: 'offline', message: playability.reason ?? playability.status }
  }

  return null
}

async function fetchUnfilteredContinuation(videoId: string): Promise<string | null> {
  if (!videoId) return null

  try {
    const popout = await fetchPage(
      `${YOUTUBE_ORIGIN}/live_chat?is_popout=1&v=${encodeURIComponent(videoId)}`
    )
    if (popout.status !== 200) return null

    const renderer = extractInitialJson<YtInitialData>(popout.html, 'ytInitialData')?.contents
      ?.liveChatRenderer
    return unfilteredView(renderer)
  } catch {
    return null
  }
}

function unfilteredView(renderer: YtLiveChatRenderer | undefined): string | null {
  const views =
    renderer?.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer
      ?.subMenuItems ?? []
  const chosen = views.find((view) => view.title === UNFILTERED_VIEW)?.continuation
  return chosen ? (readContinuation([chosen])?.token ?? null) : null
}

function describeMissing(ref: YouTubeRef): string {
  return ref.kind === 'video-id'
    ? `no YouTube video with id ${ref.value}`
    : `no YouTube channel named ${ref.value}`
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
