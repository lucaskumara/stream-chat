import type { ThirdPartyEmote } from './types'
import { fetchOptionalJson } from '../net/fetchJson'

const API = 'https://7tv.io/v3'
const CDN_SCALES = ['1x', '2x', '3x'] as const

export type SevenTvPlatform = 'twitch' | 'kick' | 'google'

export type SevenTvEmote = ThirdPartyEmote

interface ApiFile {
  name: string
  format?: string
}

interface ApiEmote {
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

  const base = host.url.startsWith('//') ? `https:${host.url}` : host.url
  const available = new Set((host.files ?? []).map((f) => f.name))

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

  return {
    name: raw.name,
    url: one,
    srcSet,
    animated: raw.data?.animated === true,
    provider: '7tv'
  }
}

function index(set: ApiEmoteSet | undefined): Map<string, SevenTvEmote> {
  const map = new Map<string, SevenTvEmote>()
  for (const raw of set?.emotes ?? []) {
    const emote = toEmote(raw)

    if (emote) map.set(emote.name, emote)
  }
  return map
}

export class SevenTvEmotes {
  private global: Map<string, SevenTvEmote> | null = null
  private byChannel = new Map<string, Map<string, SevenTvEmote>>()
  private inFlight = new Map<string, Promise<void>>()

  async loadGlobal(): Promise<void> {
    if (this.global) return
    const set = await fetchOptionalJson<ApiEmoteSet>(`${API}/emote-sets/global`)
    this.global = index(set ?? undefined)
  }

  async loadChannel(platform: SevenTvPlatform, channelId: string): Promise<void> {
    const key = `${platform}:${channelId}`
    if (this.byChannel.has(key)) return

    const existing = this.inFlight.get(key)
    if (existing) return existing

    const task = (async (): Promise<void> => {
      await this.loadGlobal()
      const user = await fetchOptionalJson<{ emote_set?: ApiEmoteSet }>(
        `${API}/users/${platform}/${encodeURIComponent(channelId)}`
      )

      this.byChannel.set(key, index(user?.emote_set))
      this.inFlight.delete(key)
    })()

    this.inFlight.set(key, task)
    return task
  }

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
