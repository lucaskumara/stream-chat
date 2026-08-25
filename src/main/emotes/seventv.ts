import type { ThirdPartyEmote } from './types'

const API = 'https://7tv.io/v3'
const CDN_SCALES = ['1x', '2x', '3x'] as const

/** 7TV names its YouTube platform GOOGLE, not "youtube". */
export type SevenTvPlatform = 'twitch' | 'kick' | 'google'

export type SevenTvEmote = ThirdPartyEmote

interface ApiFile {
  name: string
  format?: string
}

interface ApiEmote {
  /** Channel-specific alias; may differ from the emote's canonical name. */
  name: string
  data?: {
    animated?: boolean
    host?: { url?: string; files?: ApiFile[] }
  }
}

interface ApiEmoteSet {
  emotes?: ApiEmote[]
}

function toEmote(raw: ApiEmote): SevenTvEmote | null {
  const host = raw.data?.host
  if (!raw.name || !host?.url) return null

  // host.url is protocol-relative, e.g. //cdn.7tv.app/emote/<id>
  const base = host.url.startsWith('//') ? `https:${host.url}` : host.url
  const available = new Set((host.files ?? []).map((f) => f.name))

  // webp is universally present and far smaller than gif for animated emotes.
  const pick = (scale: string): string | null =>
    available.has(`${scale}.webp`) ? `${base}/${scale}.webp` : null

  const one = pick('1x')
  if (!one) return null

  const srcSet = CDN_SCALES.map((s, i) => {
    const u = pick(s)
    return u ? `${u} ${i + 1}x` : null
  })
    .filter(Boolean)
    .join(', ')

  return { name: raw.name, url: one, srcSet, animated: raw.data?.animated === true }
}

function index(set: ApiEmoteSet | undefined): Map<string, SevenTvEmote> {
  const map = new Map<string, SevenTvEmote>()
  for (const raw of set?.emotes ?? []) {
    const emote = toEmote(raw)
    // Names are matched case-sensitively, the way 7TV itself does it.
    if (emote) map.set(emote.name, emote)
  }
  return map
}

/**
 * Fetches and caches 7TV emote sets. Entirely unauthenticated — the only input
 * is the channel's platform id, which anonymous IRC already hands us in the
 * room-id tag, so this needs no sign-in and no API key.
 */
export class SevenTvEmotes {
  private global: Map<string, SevenTvEmote> | null = null
  private byChannel = new Map<string, Map<string, SevenTvEmote>>()
  private inFlight = new Map<string, Promise<void>>()

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      // Emotes are cosmetic; a 7TV outage must never disturb chat.
      return null
    }
  }

  async loadGlobal(): Promise<void> {
    if (this.global) return
    const set = await this.fetchJson<ApiEmoteSet>(`${API}/emote-sets/global`)
    this.global = index(set ?? undefined)
  }

  /** `channelId` is the platform's own id: Twitch room-id, Kick numeric id, YouTube UC…. */
  async loadChannel(platform: SevenTvPlatform, channelId: string): Promise<void> {
    const key = `${platform}:${channelId}`
    if (this.byChannel.has(key)) return

    const existing = this.inFlight.get(key)
    if (existing) return existing

    const task = (async (): Promise<void> => {
      await this.loadGlobal()
      const user = await this.fetchJson<{ emote_set?: ApiEmoteSet }>(
        `${API}/users/${platform}/${encodeURIComponent(channelId)}`
      )
      // A channel with no 7TV account caches as empty so we stop asking.
      this.byChannel.set(key, index(user?.emote_set))
      this.inFlight.delete(key)
    })()

    this.inFlight.set(key, task)
    return task
  }

  /** Channel emotes win over global, matching 7TV's own precedence. */
  lookup(platform: SevenTvPlatform, channelId: string, name: string): SevenTvEmote | undefined {
    return (
      this.byChannel.get(`${platform}:${channelId}`)?.get(name) ?? this.global?.get(name)
    )
  }

  count(platform: SevenTvPlatform, channelId: string): number {
    return this.byChannel.get(`${platform}:${channelId}`)?.size ?? 0
  }

  forget(platform: SevenTvPlatform, channelId: string): void {
    this.byChannel.delete(`${platform}:${channelId}`)
  }
}
