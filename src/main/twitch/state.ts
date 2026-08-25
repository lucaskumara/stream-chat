import type { TwitchAuthState } from '@shared/types'
import type { TwitchAuth } from './auth'

export function buildAuthState(auth: TwitchAuth): TwitchAuthState {
  if (!auth.getClientId()) return { status: 'not-configured' }

  const tokens = auth.getTokens()
  if (tokens) {
    return {
      status: 'signed-in',
      login: tokens.login,
      userId: tokens.userId,
      scopes: tokens.scopes
    }
  }

  if (auth.isPending()) return { status: 'pending' }

  const failure = auth.getFailure()
  if (failure) return { status: 'error', error: failure }

  return { status: 'signed-out' }
}
