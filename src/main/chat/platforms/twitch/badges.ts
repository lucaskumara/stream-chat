import type { Badge } from '@shared/types'
import { twitchGql } from './gql'

const READY_DEADLINE_MS = 1_500

interface GqlBadge {
  setID: string;
  version: string;
  title: string;

  small: string;
  medium: string;
  large: string;
}

interface BadgeData {
  badges?: GqlBadge[] | null;
  user?: { broadcastBadges?: GqlBadge[] | null } | null;
}

class TwitchBadges {
  private static readonly QUERY =
    'fragment B on Badge{setID version title' +
    ' small:imageURL(size:NORMAL)' +
    ' medium:imageURL(size:DOUBLE)' +
    ' large:imageURL(size:QUADRUPLE)}' +
    'query($login:String!){badges{...B}user(login:$login){broadcastBadges{...B}}}'

  private global = new Map<string, Badge>()

  private readonly byChannel = new Map<string, Map<string, Badge>>()

  private readonly loading = new Map<string, Promise<void>>()

  load(login: string): Promise<void> {
    const running = this.loading.get(login)
    if (running) return running

    if (this.byChannel.has(login)) return Promise.resolve()

    const fetching = this.fetchFor(login)
      .catch(() => {
        this.byChannel.delete(login)
      })
      .finally(() => this.loading.delete(login))

    this.loading.set(login, fetching)

    return fetching
  }

  ready(login: string): Promise<void> {
    return Promise.race([this.load(login), expire(READY_DEADLINE_MS)])
  }

  lookup(login: string, setId: string, version: string): Badge | null {
    const key = `${setId}/${version}`

    return this.byChannel.get(login)?.get(key) ?? this.global.get(key) ?? null
  }

  private async fetchFor(login: string): Promise<void> {
    const data = await twitchGql<BadgeData>(TwitchBadges.QUERY, { login })
    if (!data) return

    if (data.badges) this.global = this.index(data.badges)

    this.byChannel.set(login, this.index(data.user?.broadcastBadges ?? []))
  }

  private index(badges: GqlBadge[]): Map<string, Badge> {
    const indexed = new Map<string, Badge>()

    for (const badge of badges) {
      indexed.set(`${badge.setID}/${badge.version}`, {
        label: badge.title,
        url: badge.small,
        srcSet: `${badge.small} 1x, ${badge.medium} 2x, ${badge.large} 4x`,
      })
    }

    return indexed
  }
}

function expire(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs).unref())
}

export const twitchBadges = new TwitchBadges()
