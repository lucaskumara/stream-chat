import type { Platform } from '@shared/types'
import { Channel, type ChannelLookup } from '../../channel'
import type { TwitchAuth } from '../../../twitch/auth'
import type { Helix } from '../../../twitch/helix'
import type { EmoteBinding } from '../../../emotes'
import { twitchGql } from './gql'

const IDENTITY_QUERY = 'query($login:String!){user(login:$login){id displayName}}'

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
}

export async function resolveChannel(
  identifier: string,
  auth: TwitchAuth,
  helix: Helix
): Promise<ChannelLookup<TwitchChannel>> {
  const login = identifier.trim().toLowerCase().replace(/^@/, '')

  if (!login) {
    return { state: 'missing', reason: 'no Twitch channel name given' }
  }

  if (!auth.isSignedIn()) {
    const identity = await anonymousIdentity(login)

    return {
      state: 'ok',
      channel: new TwitchChannel(identity.displayName, login, identity.id)
    }
  }

  try {
    const user = await helix.getUserByLogin(login)

    if (!user) {
      return {
        state: 'missing',
        reason: `Twitch channel "${login}" does not exist.`
      }
    }

    return {
      state: 'ok',
      channel: new TwitchChannel(user.display_name || user.login, user.login, user.id)
    }
  } catch (error) {
    return {
      state: 'unreachable',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

async function anonymousIdentity(
  login: string
): Promise<{ id: string; displayName: string }> {
  try {
    const data = await twitchGql<{ user?: { id?: string; displayName?: string } | null }>(
      IDENTITY_QUERY,
      { login }
    )

    return { id: data?.user?.id ?? '', displayName: data?.user?.displayName || login }
  } catch {
    return { id: '', displayName: login }
  }
}
