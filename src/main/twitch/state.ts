import type { AccountState } from '@shared/types'
import type { TwitchAuth } from './auth'
import { SCOPES } from './auth'

/** Only scopes the token actually carries become grants. A token minted before a
    scope was added keeps working for everything else, so this reads the stored list
    rather than assuming SCOPES was what the user approved. */
const GRANTS: Record<string, string> = {
  'user:read:chat': 'read chat',
  'channel:read:stream_key': 'stream key'
}

export function twitchAccount(auth: TwitchAuth): AccountState {
  if (!auth.getClientId()) return { platform: 'twitch', status: 'not-configured' }

  const tokens = auth.getTokens()
  if (tokens) {
    return {
      platform: 'twitch',
      status: 'signed-in',
      userId: tokens.userId,
      displayName: tokens.login,
      grants: grantsFor(tokens.scopes)
    }
  }

  const prompt = auth.getPrompt()
  if (prompt) return { platform: 'twitch', status: 'pending', prompt }

  if (auth.isPending()) return { platform: 'twitch', status: 'pending' }

  const failure = auth.getFailure()
  if (failure) return { platform: 'twitch', status: 'error', error: failure }

  return { platform: 'twitch', status: 'signed-out' }
}

function grantsFor(scopes: string[]): string[] {
  return scopes.map((scope) => GRANTS[scope]).filter((grant): grant is string => !!grant)
}

/** True when the stored token predates a scope this build asks for, which is the one
    case where a working sign-in still needs redoing. */
export function twitchScopesStale(auth: TwitchAuth): boolean {
  const tokens = auth.getTokens()
  if (!tokens) return false

  return SCOPES.some((scope) => !tokens.scopes.includes(scope))
}
