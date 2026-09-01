import { describe, expect, it } from 'vitest'
import type { OAuthProvider } from '@main/accounts/oauth'
import { authorizeUrl, scopesOf, tokensFrom } from '@main/accounts/oauth'
import { challengeFor, createState, createVerifier, readRedirect } from '@main/accounts/pkce'

const GOOGLE: OAuthProvider = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: 'client-123',
  scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
  redirectHost: '127.0.0.1',
  extraAuthParams: { access_type: 'offline', prompt: 'consent' }
}

const KICK: OAuthProvider = {
  authorizeUrl: 'https://id.kick.com/oauth/authorize',
  tokenUrl: 'https://id.kick.com/oauth/token',
  clientId: 'kick-123',
  clientSecret: 'shh',
  scopes: ['user:read', 'channel:read', 'streamkey:read'],
  redirectHost: 'localhost'
}

describe('authorizeUrl', () => {
  it('carries every parameter both providers require', () => {
    const url = new URL(authorizeUrl(KICK, 'http://localhost:4569/callback', 'chal', 'st'))

    expect(url.origin + url.pathname).toBe('https://id.kick.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('kick-123')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4569/callback')
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('code_challenge')).toBe('chal')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('space-delimits scopes', () => {
    const url = new URL(authorizeUrl(KICK, 'http://localhost:4569/callback', 'c', 's'))

    expect(url.searchParams.get('scope')).toBe('user:read channel:read streamkey:read')
  })

  // Without access_type=offline and prompt=consent Google returns an access token and no
  // refresh token, and the account falls out silently an hour later.
  it('keeps the params that make Google issue a refresh token', () => {
    const url = new URL(authorizeUrl(GOOGLE, 'http://127.0.0.1:4569/callback', 'c', 's'))

    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('never puts the client secret in the authorize URL', () => {
    expect(authorizeUrl(KICK, 'http://localhost:4569/callback', 'c', 's')).not.toContain('shh')
  })
})

describe('scopesOf', () => {
  it('splits a space-delimited scope string', () => {
    expect(scopesOf({ access_token: 'a', scope: 'user:read channel:read' }, [])).toEqual([
      'user:read',
      'channel:read'
    ])
  })

  it('accepts an array, which is what Twitch sends', () => {
    expect(scopesOf({ access_token: 'a', scope: ['user:read'] }, [])).toEqual(['user:read'])
  })

  it('falls back to what was requested when the response is silent', () => {
    expect(scopesOf({ access_token: 'a' }, ['user:read'])).toEqual(['user:read'])
  })
})

describe('tokensFrom', () => {
  // Kick rotates the refresh token on every refresh and Google reuses one, so a response
  // with no refresh_token must keep the old one or the session is lost on first refresh.
  it('keeps the previous refresh token when the response omits one', () => {
    const tokens = tokensFrom({ access_token: 'new' }, GOOGLE, 'old-refresh')

    expect(tokens.refreshToken).toBe('old-refresh')
  })

  it('prefers a rotated refresh token', () => {
    const tokens = tokensFrom({ access_token: 'a', refresh_token: 'new' }, KICK, 'old')

    expect(tokens.refreshToken).toBe('new')
  })

  it('turns expires_in into an absolute deadline', () => {
    const before = Date.now()
    const tokens = tokensFrom({ access_token: 'a', expires_in: 3600 }, GOOGLE)

    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(tokens.expiresAt).toBeLessThan(before + 3601 * 1000)
  })
})

describe('pkce', () => {
  it('produces a base64url verifier with no padding or unsafe characters', () => {
    expect(createVerifier()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('does not repeat a verifier', () => {
    expect(createVerifier()).not.toBe(createVerifier())
  })

  it('hashes the verifier with S256, base64url encoded', () => {
    // RFC 7636 appendix B's worked example.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'

    expect(challengeFor(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('is stable for the same verifier', () => {
    const verifier = createVerifier()

    expect(challengeFor(verifier)).toBe(challengeFor(verifier))
  })
})

describe('readRedirect', () => {
  const at = (query: string): URL => new URL(`http://127.0.0.1:4569/callback${query}`)

  it('returns the code when the state matches', () => {
    expect(readRedirect(at('?code=abc&state=xyz'), 'xyz')).toEqual({ code: 'abc' })
  })

  // Loopback is a surface anything on the machine can reach, so a redirect whose state
  // we did not issue must be refused rather than exchanged.
  it('refuses a redirect whose state does not match', () => {
    const result = readRedirect(at('?code=abc&state=someone-else'), 'xyz')

    expect(result.code).toBeUndefined()
    expect(result.error).toMatch(/state mismatch/)
  })

  it('refuses a redirect carrying no state at all', () => {
    expect(readRedirect(at('?code=abc'), 'xyz').error).toMatch(/state mismatch/)
  })

  it('surfaces the provider’s own error ahead of the state check', () => {
    expect(readRedirect(at('?error=access_denied&state=nope'), 'xyz')).toEqual({
      error: 'access_denied'
    })
  })

  it('refuses a matching redirect that carries no code', () => {
    expect(readRedirect(at('?state=xyz'), 'xyz').error).toMatch(/no authorization code/)
  })

  it('generates states that differ between sign-ins', () => {
    expect(createState()).not.toBe(createState())
  })
})
