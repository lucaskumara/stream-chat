import { describe, expect, it, vi } from 'vitest'
import type { DeviceCodePrompt } from '@shared/types'

// state.ts reaches electron only through auth.ts's config import, and none of the
// branches under test touch it.
vi.mock('electron', () => ({
  app: { getPath: () => '.' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { twitchAccount, twitchScopesStale } = await import('@main/twitch/state')

type Auth = Parameters<typeof twitchAccount>[0]

interface Stub {
  clientId?: string
  tokens?: { userId: string; login: string; scopes: string[] } | null
  prompt?: DeviceCodePrompt | null
  pending?: boolean
  failure?: string | null
}

function auth(stub: Stub): Auth {
  return {
    getClientId: () => stub.clientId,
    getTokens: () => stub.tokens ?? null,
    getPrompt: () => stub.prompt ?? null,
    isPending: () => stub.pending ?? false,
    getFailure: () => stub.failure ?? null
  } as unknown as Auth
}

const PROMPT: DeviceCodePrompt = {
  userCode: 'ABCD-1234',
  verificationUri: 'https://www.twitch.tv/activate',
  expiresAt: 0,
  interval: 5
}

describe('twitchAccount', () => {
  it('reports a build with no Client ID as not-configured', () => {
    expect(twitchAccount(auth({}))).toEqual({
      platform: 'twitch',
      status: 'not-configured'
    })
  })

  it('carries the identity and grants of a signed-in token', () => {
    const state = twitchAccount(
      auth({
        clientId: 'id',
        tokens: { userId: '42', login: 'peanut', scopes: ['user:read:chat'] }
      })
    )

    expect(state.status).toBe('signed-in')
    expect(state.userId).toBe('42')
    expect(state.displayName).toBe('peanut')
    expect(state.grants).toEqual(['read chat'])
  })

  // Grants come off the stored token, not off SCOPES: a token minted before a scope
  // was added keeps working, and must not claim access it was never granted.
  it('grants only what the stored token actually carries', () => {
    const state = twitchAccount(
      auth({
        clientId: 'id',
        tokens: { userId: '1', login: 'a', scopes: ['user:read:chat'] }
      })
    )

    expect(state.grants).not.toContain('stream key')
  })

  it('names both grants once the stream key scope is present', () => {
    const state = twitchAccount(
      auth({
        clientId: 'id',
        tokens: {
          userId: '1',
          login: 'a',
          scopes: ['user:read:chat', 'channel:read:stream_key']
        }
      })
    )

    expect(state.grants).toEqual(['read chat', 'stream key'])
  })

  it('drops a scope it has no wording for rather than printing the raw scope', () => {
    const state = twitchAccount(
      auth({ clientId: 'id', tokens: { userId: '1', login: 'a', scopes: ['moderator:x'] } })
    )

    expect(state.grants).toEqual([])
  })

  it('passes the device prompt through while polling', () => {
    const state = twitchAccount(auth({ clientId: 'id', prompt: PROMPT, pending: true }))

    expect(state.status).toBe('pending')
    expect(state.prompt?.userCode).toBe('ABCD-1234')
  })

  it('is still pending with no prompt to show', () => {
    expect(twitchAccount(auth({ clientId: 'id', pending: true })).status).toBe('pending')
  })

  it('reports a failure once polling has stopped', () => {
    const state = twitchAccount(auth({ clientId: 'id', failure: 'denied' }))

    expect(state).toEqual({ platform: 'twitch', status: 'error', error: 'denied' })
  })

  // A stored token outranks a stale failure — signing in again after a denial must not
  // leave the row reading as an error.
  it('prefers a live token over a leftover failure', () => {
    const state = twitchAccount(
      auth({
        clientId: 'id',
        tokens: { userId: '1', login: 'a', scopes: [] },
        failure: 'denied'
      })
    )

    expect(state.status).toBe('signed-in')
  })

  it('falls through to signed-out', () => {
    expect(twitchAccount(auth({ clientId: 'id' })).status).toBe('signed-out')
  })
})

describe('twitchScopesStale', () => {
  it('is false when signed out — there is nothing to redo', () => {
    expect(twitchScopesStale(auth({ clientId: 'id' }))).toBe(false)
  })

  it('spots a token minted before a scope this build asks for', () => {
    const stale = twitchScopesStale(
      auth({ clientId: 'id', tokens: { userId: '1', login: 'a', scopes: ['user:read:chat'] } })
    )

    expect(stale).toBe(true)
  })

  it('is false once every requested scope is present', () => {
    const stale = twitchScopesStale(
      auth({
        clientId: 'id',
        tokens: {
          userId: '1',
          login: 'a',
          scopes: ['user:read:chat', 'channel:read:stream_key']
        }
      })
    )

    expect(stale).toBe(false)
  })
})
