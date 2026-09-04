import type { Badge, Platform } from '@shared/types'
import { Channel, type ChannelLookup } from '../../channel'
import type { EmoteBinding } from '../../../emotes'

const API = 'https://kick.com/api/v2'

interface ApiChannel {
  slug?: string
  user_id?: number
  chatroom?: { id?: number }
  user?: { username?: string }
  subscriber_badges?: { months?: number; badge_image?: { src?: string } }[]
}

interface SubscriberBadge {
  months: number
  badge: Badge
}

export class KickChannel extends Channel {
  readonly platform: Platform = 'kick'

  constructor(
    displayName: string,
    readonly slug: string,
    readonly chatroomId: number,
    readonly userId: number,
    private readonly subscriberBadges: SubscriberBadge[]
  ) {
    super(displayName)
  }

  get emotes(): EmoteBinding | null {
    if (!this.userId) return null

    return { platform: 'kick', channelId: String(this.userId) }
  }

  get url(): string {
    return `https://kick.com/${this.slug}`
  }

  static fromApi(raw: ApiChannel, requestedSlug: string): KickChannel | null {
    const chatroomId = raw.chatroom?.id
    if (!chatroomId) return null

    const tiers: SubscriberBadge[] = []

    for (const tier of raw.subscriber_badges ?? []) {
      const src = tier.badge_image?.src
      if (!src || tier.months === undefined) continue

      tiers.push({
        months: tier.months,
        badge: { label: KickChannel.subscriberLabel(tier.months), url: src }
      })
    }

    tiers.sort((a, b) => a.months - b.months)

    return new KickChannel(
      raw.user?.username ?? raw.slug ?? requestedSlug,
      raw.slug ?? requestedSlug,
      chatroomId,
      raw.user_id ?? 0,
      tiers
    )
  }

  get room(): string {
    return `chatrooms.${this.chatroomId}.v2`
  }

  subscriberBadge(months: number): Badge {
    let earned: Badge = {
      label: KickChannel.subscriberLabel(months),
      id: 'subscriber'
    }

    for (const tier of this.subscriberBadges) {
      if (tier.months > months) break

      earned = tier.badge
    }

    return earned
  }

  private static subscriberLabel(months: number): string {
    return months === 1 ? 'Subscriber (1 month)' : `Subscriber (${months} months)`
  }
}

export async function resolveChannel(identifier: string): Promise<ChannelLookup<KickChannel>> {
  const slug = identifier.trim()

  let response: Response

  try {
    response = await fetch(`${API}/channels/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' }
    })
  } catch (error) {
    return {
      state: 'unreachable',
      reason: error instanceof Error ? error.message : String(error)
    }
  }

  if (response.status === 404) {
    return { state: 'missing', reason: `Kick has no channel called "${slug}".` }
  }

  if (!response.ok) {
    return { state: 'unreachable', reason: `Kick answered ${response.status}` }
  }

  const channel = KickChannel.fromApi((await response.json()) as ApiChannel, slug)

  if (!channel) {
    return { state: 'unreachable', reason: `${slug} has no readable chatroom` }
  }

  return { state: 'ok', channel }
}
