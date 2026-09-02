import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredTokens } from '@main/config'

const tokens: { current: StoredTokens | null } = { current: null }

vi.mock('electron', () => ({
  shell: { openExternal: async () => {} },
  app: { getPath: () => '.' },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('@main/config', () => ({
  config: () => ({
    getTokens: () => tokens.current,
    setTokens: (_platform: string, next: StoredTokens | null) => {
      tokens.current = next
    },
    getClientId: () => undefined
  })
}))

const { KickAccount } = await import('@main/kick/auth')

const SIGNED_IN: StoredTokens = {
  accessToken: 'token',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  scopes: ['user:read', 'channel:read', 'chat:write'],
  userId: '123',
  login: 'someone',
  channel: 'someone'
}

/** Reaches the protected identify/grantsFor without exporting them from the class. */
class Probe extends KickAccount {
  identifyWith(token: string): Promise<{ channel?: string; displayName?: string }> {
    return this['identify'](token)
  }

  grants(scopes: string[]): string[] {
    return this['grantsFor'](scopes)
  }
}

function account(): Probe {
  return new Probe(() => {})
}

function reply(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body
  } as unknown as Response
}

beforeEach(() => {
  tokens.current = { ...SIGNED_IN }
  process.env['KICK_CLIENT_ID'] = 'id'
  process.env['KICK_CLIENT_SECRET'] = 'secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env['KICK_CLIENT_ID']
  delete process.env['KICK_CLIENT_SECRET']
})

describe('identify', () => {
  // The slug is what chat connects to, and it is not always the username — the account's
  // own channel comes from /channels with no parameters.
  it('takes the channel identifier from the slug, not the username', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/channels')
          ? reply({ data: [{ slug: 'my-channel', broadcaster_user_id: 987 }] })
          : reply({ data: [{ user_id: 987, name: 'Someone' }] })
      )
    )

    const identity = await account().identifyWith('token')

    expect(identity.channel).toBe('my-channel')
    expect(identity.displayName).toBe('Someone')
  })

  it('falls back to the slug when the name lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/channels')
          ? reply({ data: [{ slug: 'my-channel', broadcaster_user_id: 987 }] })
          : reply({ message: 'nope' }, false, 500)
      )
    )

    expect((await account().identifyWith('token')).displayName).toBe('my-channel')
  })

  it('refuses an account with no channel rather than connecting to nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: [] })))

    await expect(account().identifyWith('token')).rejects.toThrow(/no channel/)
  })
})

describe('grantsFor', () => {
  it('names the scopes it has wording for', () => {
    expect(account().grants(['user:read', 'chat:write'])).toEqual([
      'read your account',
      'send chat'
    ])
  })

  // streamkey:read is deliberately not requested — Kick's OpenAPI spec has no endpoint
  // behind it — so it has no wording and must not appear if a stored token carries it.
  it('drops a scope it has no wording for', () => {
    expect(account().grants(['streamkey:read'])).toEqual([])
  })
})

describe('sendChatMessage', () => {
  it('posts as a user with the target broadcaster id', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      reply({ data: { is_sent: true, message_id: 'x' } })
    )
    vi.stubGlobal('fetch', fetcher)

    await account().sendChatMessage(987, 'hello')

    const [url, init] = fetcher.mock.calls[0]

    expect(url).toContain('/public/v1/chat')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'user',
      content: 'hello',
      broadcaster_user_id: 987
    })
  })

  // Kick answers 200 while dropping the message, exactly as Twitch does. Checking only
  // res.ok would clear the composer on a message nobody saw.
  it('treats 200 with is_sent false as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: { is_sent: false }, message: 'slow mode' })))

    await expect(account().sendChatMessage(987, 'hello')).rejects.toThrow(/slow mode/)
  })

  it('surfaces Kick’s own message on a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ message: 'Unauthorized' }, false, 401)))

    await expect(account().sendChatMessage(987, 'hi')).rejects.toThrow(/Unauthorized/)
  })

  it('refuses to send while signed out', async () => {
    tokens.current = null
    vi.stubGlobal('fetch', vi.fn())

    await expect(account().sendChatMessage(987, 'hi')).rejects.toThrow(/Sign in to Kick/)
  })
})

describe('broadcasterId', () => {
  // The id on the chat-side KickChannel comes from Kick's internal API; assuming it
  // matches the public API's broadcaster_user_id would be a guess, so this asks.
  it('resolves a slug through the public API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ data: [{ slug: 'xqc', broadcaster_user_id: 676 }] }))
    )

    expect(await account().broadcasterId('xqc')).toBe(676)
  })

  it('asks once and caches, because a channel id does not move', async () => {
    const fetcher = vi.fn(async () => reply({ data: [{ broadcaster_user_id: 676 }] }))
    vi.stubGlobal('fetch', fetcher)

    const kick = account()
    await kick.broadcasterId('xqc')
    await kick.broadcasterId('xqc')

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('answers null when Kick knows no such channel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: [] })))

    expect(await account().broadcasterId('nobody')).toBeNull()
  })
})
