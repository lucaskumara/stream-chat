import type { TwitchAuthState } from '@shared/types'
import type { TwitchAuth } from './auth'

/**
 * Derives the renderer-facing auth state from the auth object. Kept separate so
 * both the IPC handler and the push notifier report exactly the same shape.
 */
export function buildAuthState(auth: TwitchAuth): TwitchAuthState {
  if (!auth.getClientId()) return { status: 'no-client-id' }

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
