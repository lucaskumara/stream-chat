import type { Platform } from '@shared/types'
import { Channel, type ChannelLookup } from '../../channel'
import type { TwitchAuth } from '../../../twitch/auth'
import type { Helix } from '../../../twitch/helix'
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
}

export async function resolveChannel(
  identifier: string,
  auth: TwitchAuth,
  helix: Helix
): Promise<ChannelLookup<TwitchChannel>> {
  const login = identifier.trim().toLowerCase().replace(/^@/, '')

  if (!login) {
    return { state: 'missing', reason: 'No Twitch channel name given.' }
  }

  if (!auth.isSignedIn()) return anonymousLookup(login)

  try {
    const user = await helix.getUserByLogin(login)

    if (!user) {
      return { state: 'missing', reason: missingTwitch(login) }
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
