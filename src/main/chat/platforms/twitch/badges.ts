import type { Badge } from "@shared/types";
import { twitchGql } from "./gql";

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
    "fragment B on Badge{setID version title" +
    " small:imageURL(size:NORMAL)" +
    " medium:imageURL(size:DOUBLE)" +
    " large:imageURL(size:QUADRUPLE)}" +
    "query($login:String!){badges{...B}user(login:$login){broadcastBadges{...B}}}";

  private global = new Map<string, Badge>();

  private readonly byChannel = new Map<string, Map<string, Badge>>();

  private readonly loading = new Set<string>();

  load(login: string): void {
    if (this.byChannel.has(login) || this.loading.has(login)) return;

    this.loading.add(login);

    void this.fetchFor(login)
      .catch(() => this.byChannel.delete(login))
      .finally(() => this.loading.delete(login));
  }

  lookup(login: string, setId: string, version: string): Badge | null {
    const key = `${setId}/${version}`;

    return this.byChannel.get(login)?.get(key) ?? this.global.get(key) ?? null;
  }

  private async fetchFor(login: string): Promise<void> {
    const data = await twitchGql<BadgeData>(TwitchBadges.QUERY, { login });
    if (!data) return;

    if (data.badges) this.global = this.index(data.badges);

    this.byChannel.set(login, this.index(data.user?.broadcastBadges ?? []));
  }

  private index(badges: GqlBadge[]): Map<string, Badge> {
    const indexed = new Map<string, Badge>();

    for (const badge of badges) {
      indexed.set(`${badge.setID}/${badge.version}`, {
        label: badge.title,
        url: badge.small,
        srcSet: `${badge.small} 1x, ${badge.medium} 2x, ${badge.large} 4x`,
      });
    }

    return indexed;
  }
}

export const twitchBadges = new TwitchBadges();
