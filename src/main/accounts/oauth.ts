export interface OAuthProvider {
  authorizeUrl: string
  tokenUrl: string
  revokeUrl?: string

  clientId: string

  /** Optional because Google states plainly that installed apps cannot keep secrets and
      makes it optional. Kick requires one on both the code and refresh grants, with no
      public-client alternative — so a Kick build ships a secret or has no Kick sign-in. */
  clientSecret?: string

  scopes: string[]

  /** Google documents the loopback redirect as `127.0.0.1`; Kick asks for `localhost`,
      because their frontend rewrites the first `127.0.0.1` it finds in the URL. */
  redirectHost: 'localhost' | '127.0.0.1'

  /** access_type=offline and prompt=consent on Google's side, which is what makes it
      hand back a refresh token rather than an access token alone. */
  extraAuthParams?: Record<string, string>
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string | string[]
  token_type?: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
}

export class OAuthError extends Error {}

export function authorizeUrl(
  provider: OAuthProvider,
  redirectUri: string,
  challenge: string,
  state: string
): string {
  const url = new URL(provider.authorizeUrl)

  url.searchParams.set('client_id', provider.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', provider.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')

  for (const [key, value] of Object.entries(provider.extraAuthParams ?? {})) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

export function scopesOf(response: TokenResponse, fallback: string[]): string[] {
  if (Array.isArray(response.scope)) return response.scope
  if (typeof response.scope === 'string') return response.scope.split(' ').filter(Boolean)

  return fallback
}

/** Both providers answer the same shape, so the only per-provider part is which fields
    go in the body. A refresh that comes back without a new refresh token keeps the old
    one — Google reuses, Kick rotates, and neither may drop the user's session. */
export function tokensFrom(
  response: TokenResponse,
  provider: OAuthProvider,
  previousRefresh = ''
): OAuthTokens {
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token || previousRefresh,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    scopes: scopesOf(response, provider.scopes)
  }
}

async function post(url: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })

  const text = await res.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new OAuthError(`${res.status} ${text.slice(0, 200)}`)
  }

  const record = parsed as { error?: string; error_description?: string }

  if (!res.ok || record.error) {
    throw new OAuthError(record.error_description || record.error || `${res.status}`)
  }

  return parsed as TokenResponse
}

function withSecret(
  provider: OAuthProvider,
  body: Record<string, string>
): Record<string, string> {
  if (!provider.clientSecret) return body

  return { ...body, client_secret: provider.clientSecret }
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<OAuthTokens> {
  const response = await post(
    provider.tokenUrl,
    withSecret(provider, {
      grant_type: 'authorization_code',
      client_id: provider.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri
    })
  )

  return tokensFrom(response, provider)
}

export async function refreshTokens(
  provider: OAuthProvider,
  refreshToken: string
): Promise<OAuthTokens> {
  const response = await post(
    provider.tokenUrl,
    withSecret(provider, {
      grant_type: 'refresh_token',
      client_id: provider.clientId,
      refresh_token: refreshToken
    })
  )

  return tokensFrom(response, provider, refreshToken)
}

export async function revokeToken(provider: OAuthProvider, token: string): Promise<void> {
  if (!provider.revokeUrl) return

  try {
    await fetch(`${provider.revokeUrl}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  } catch {
    // Local sign-out must succeed whether or not the server acknowledges the revoke.
  }
}
