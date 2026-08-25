import type { ThirdPartyEmote } from './types'

const API = 'https://api.betterttv.net/3'
const CDN = 'https://cdn.betterttv.net/emote'

interface ApiEmote {
  id: string
  code: string
  animated?: boolean
}

interface ApiChannel {
  /** Emotes uploaded by this channel. */
  channelEmotes?: ApiEmote[]
  /** Emotes the channel has adopted from BTTV's shared library. */
  sharedEmotes?: ApiEmote[]
}

function toEmote(raw: ApiEmote): ThirdPartyEmote | null {
  if (!raw.id || !raw.code) return null
  // BTTV serves webp at every scale regardless of the source imageType.
  const at = (scale: string): string => `${CDN}/${raw.id}/${scale}.webp`
  return {
    name: raw.code,
    url: at('1x'),
    srcSet: `${at('1x')} 1x, ${at('2x')} 2x, ${at('3x')} 3x`,
    animated: raw.animated === true,
    provider: 'bttv'
  }
}

function index(list: ApiEmote[]): Map<string, ThirdPartyEmote> {
  const map = new Map<string, ThirdPartyEmote>()
  for (const raw of list) {
    const emote = toEmote(raw)
    if (emote) map.set(emote.name, emote)
  }
  return map
}

/**
 * BetterTTV emotes. Still worth having despite 7TV's dominance: some large
 * channels have no 7TV set at all and hundreds of BTTV emotes, and without
 * this their chat renders as bare words.
 *
 * Twitch only — BTTV keys channels by Twitch user id.
 */
export class BttvEmotes {
  private global: Map<string, ThirdPartyEmote> | null = null
  private byChannel = new Map<string, Map<string, ThirdPartyEmote>>()
  private inFlight = new Map<string, Promise<void>>()

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }

  async loadGlobal(): Promise<void> {
    if (this.global) return
    const list = await this.fetchJson<ApiEmote[]>(`${API}/cached/emotes/global`)
    this.global = index(list ?? [])
  }

  async loadChannel(twitchId: string): Promise<void> {
    if (this.byChannel.has(twitchId)) return
    const existing = this.inFlight.get(twitchId)
    if (existing) return existing

    const task = (async (): Promise<void> => {
      await this.loadGlobal()
      const data = await this.fetchJson<ApiChannel>(
        `${API}/cached/users/twitch/${encodeURIComponent(twitchId)}`
      )
      // A channel with no BTTV account caches empty so we stop asking.
      this.byChannel.set(
        twitchId,
        index([...(data?.channelEmotes ?? []), ...(data?.sharedEmotes ?? [])])
      )
      this.inFlight.delete(twitchId)
    })()

    this.inFlight.set(twitchId, task)
    return task
  }

  lookup(twitchId: string, name: string): ThirdPartyEmote | undefined {
    return this.byChannel.get(twitchId)?.get(name) ?? this.global?.get(name)
  }

  count(twitchId: string): number {
    return this.byChannel.get(twitchId)?.size ?? 0
  }
}
