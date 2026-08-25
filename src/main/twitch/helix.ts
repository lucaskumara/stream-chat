import type { TwitchAuth } from './auth'

const HELIX = 'https://api.twitch.tv/helix'

export interface HelixUser {
  id: string
  login: string
  display_name: string
  profile_image_url: string
}

export interface BadgeVersion {
  id: string
  image_url_1x: string
  image_url_2x: string
  image_url_4x: string
  title: string
}

export interface BadgeSet {
  set_id: string
  versions: BadgeVersion[]
}

export class HelixError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export class Helix {
  constructor(private auth: TwitchAuth) {}

  private async request<T>(
    path: string,
    init?: RequestInit & { retryOn401?: boolean }
  ): Promise<T> {
    const clientId = this.auth.getClientId()
    if (!clientId) throw new HelixError('No Twitch Client ID set.', 0)

    const token = await this.auth.getAccessToken()
    const res = await fetch(`${HELIX}${path}`, {
      ...init,
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      }
    })

    if (res.status === 204) return undefined as T

    const text = await res.text()
    if (!res.ok) {
      let message = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string }
        message = parsed.message || parsed.error || message
      } catch {
        /* keep raw text */
      }
      throw new HelixError(message, res.status)
    }

    return text ? (JSON.parse(text) as T) : (undefined as T)
  }

  /** Resolve a channel name typed by the user. Returns null when it does not exist. */
  async getUserByLogin(login: string): Promise<HelixUser | null> {
    const clean = login.trim().toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9_]{1,25}$/.test(clean)) {
      throw new HelixError(`"${login}" is not a valid Twitch channel name.`, 0)
    }
    const data = await this.request<{ data: HelixUser[] }>(
      `/users?login=${encodeURIComponent(clean)}`
    )
    return data.data[0] ?? null
  }

  /** True when the channel is broadcasting right now. */
  async isLive(userId: string): Promise<boolean> {
    const data = await this.request<{ data: unknown[] }>(
      `/streams?user_id=${encodeURIComponent(userId)}`
    )
    return data.data.length > 0
  }

  async getGlobalBadges(): Promise<BadgeSet[]> {
    const data = await this.request<{ data: BadgeSet[] }>('/chat/badges/global')
    return data.data
  }

  async getChannelBadges(broadcasterId: string): Promise<BadgeSet[]> {
    const data = await this.request<{ data: BadgeSet[] }>(
      `/chat/badges?broadcaster_id=${encodeURIComponent(broadcasterId)}`
    )
    return data.data
  }

  async createEventSubSubscription(
    type: string,
    version: string,
    condition: Record<string, string>,
    sessionId: string
  ): Promise<string> {
    const data = await this.request<{ data: { id: string }[] }>('/eventsub/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        type,
        version,
        condition,
        transport: { method: 'websocket', session_id: sessionId }
      })
    })
    const id = data.data[0]?.id
    if (!id) throw new HelixError(`subscription ${type} returned no id`, 0)
    return id
  }

  async deleteEventSubSubscription(id: string): Promise<void> {
    await this.request<void>(`/eventsub/subscriptions?id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }
}

/**
 * Badge images are per-channel plus a global fallback, and both are static for
 * long stretches, so they are fetched once per channel and cached.
 */
export class BadgeCache {
  private global: Map<string, Map<string, BadgeVersion>> | null = null
  private perChannel = new Map<string, Map<string, Map<string, BadgeVersion>>>()

  constructor(private helix: Helix) {}

  private index(sets: BadgeSet[]): Map<string, Map<string, BadgeVersion>> {
    const out = new Map<string, Map<string, BadgeVersion>>()
    for (const set of sets) {
      const versions = new Map<string, BadgeVersion>()
      for (const v of set.versions) versions.set(v.id, v)
      out.set(set.set_id, versions)
    }
    return out
  }

  async load(broadcasterId: string): Promise<void> {
    try {
      if (!this.global) this.global = this.index(await this.helix.getGlobalBadges())
      if (!this.perChannel.has(broadcasterId)) {
        this.perChannel.set(broadcasterId, this.index(await this.helix.getChannelBadges(broadcasterId)))
      }
    } catch (err) {
      // Badges are cosmetic; never let them block a chat connection.
      console.warn('[twitch] badge load failed:', err)
    }
  }

  resolve(broadcasterId: string, setId: string, versionId: string): BadgeVersion | undefined {
    return (
      this.perChannel.get(broadcasterId)?.get(setId)?.get(versionId) ??
      this.global?.get(setId)?.get(versionId)
    )
  }
}
