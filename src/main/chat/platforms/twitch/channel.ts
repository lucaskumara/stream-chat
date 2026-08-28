import type { Platform } from '@shared/types'
import { Channel, type ChannelLookup } from '../../channel'
import type { TwitchAuth } from '../../../twitch/auth'
import type { Helix } from '../../../twitch/helix'
import { twitchGql } from './gql'

const DISPLAY_NAME_QUERY = 'query($login:String!){user(login:$login){displayName}}'

export class TwitchChannel extends Channel {
  readonly platform: Platform = 'twitch'

  constructor(
    displayName: string,
    readonly login: string,
    readonly broadcasterId: string
  ) {
    super(displayName)
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
    return {
      state: 'ok',
      channel: new TwitchChannel(await anonymousDisplayName(login), login, '')
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

async function anonymousDisplayName(login: string): Promise<string> {
  try {
    const data = await twitchGql<{ user?: { displayName?: string } | null }>(
      DISPLAY_NAME_QUERY,
      { login }
    )

    return data?.user?.displayName || login
  } catch {
    return login
  }
}
