import type { Platform } from '@shared/types'
import { Channel, type ChannelLookup } from '../../channel'
import type { EmoteBinding } from '../../../emotes'
import { twitchGql } from './gql'

const IDENTITY_QUERY = 'query($login:String!){user(login:$login){id displayName}}'

interface Identity {
  user?: { id?: string; displayName?: string } | null
}

export class TwitchChannel extends Channel {
  readonly platform: Platform = 'twitch'

  constructor(
    displayName: string,
    readonly login: string,
    readonly broadcasterId: string
  ) {
    super(displayName)
  }

  get emotes(): EmoteBinding | null {
    if (!this.broadcasterId) return null

    return { platform: 'twitch', channelId: this.broadcasterId }
  }

  get url(): string {
    return `https://twitch.tv/${this.login}`
  }
}

/** Anonymous, always. GQL answers `{ data: { user: null } }` for a login nobody owns,
    which is terminal; a request that never landed is not evidence about the channel, so
    it falls back to the login and connects rather than reporting a deletion. */
export async function resolveChannel(
  identifier: string
): Promise<ChannelLookup<TwitchChannel>> {
  const login = identifier.trim().toLowerCase().replace(/^@/, '')

  if (!login) {
    return { state: 'missing', reason: 'No Twitch channel name given.' }
  }

  return anonymousLookup(login)
}

function missingTwitch(login: string): string {
  return `Twitch has no channel called "${login}".`
}

async function anonymousLookup(login: string): Promise<ChannelLookup<TwitchChannel>> {
  const identity = await anonymousIdentity(login)

  if (identity && !identity.user) {
    return { state: 'missing', reason: missingTwitch(login) }
  }

  const user = identity?.user

  return {
    state: 'ok',
    channel: new TwitchChannel(user?.displayName || login, login, user?.id ?? '')
  }
}

async function anonymousIdentity(login: string): Promise<Identity | null> {
  try {
    return await twitchGql<Identity>(IDENTITY_QUERY, { login })
  } catch {
    return null
  }
}
