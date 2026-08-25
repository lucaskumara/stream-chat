import { config, type StoredTwitchTokens } from '../config'

const ID_BASE = 'https://id.twitch.tv/oauth2'

/**
 * user:read:chat is what EventSub's channel.chat.* subscriptions require when
 * authorising as a user. It is enough to read ANY channel's chat — moderator
 * status is only needed for app access tokens — which is what lets the UI add a
 * channel by name after a single sign-in.
 */
export const SCOPES = ['user:read:chat'] as const

/** Refresh this far before real expiry so a request never races the deadline. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string[] | string
}

interface ValidateResponse {
  client_id: string
  login: string
  user_id: string
  scopes: string[]
  expires_in: number
}

export class TwitchAuthError extends Error {}

async function postForm<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${ID_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })

  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new TwitchAuthError(`${res.status} ${text.slice(0, 200)}`)
  }

  if (!res.ok) {
    const rec = body as { message?: string; error?: string; error_description?: string }
    // Device-flow polling relies on reading these codes, so surface them raw.
    throw new TwitchAuthError(
      rec.message || rec.error_description || rec.error || `${res.status}`
    )
  }

  return body as T
}

/**
 * Device Code Flow. Chosen over an authorization-code loopback because a
 * desktop public client has no safe place for a client secret, and DCF still
 * returns refresh tokens.
 */
export class TwitchAuth {
  private pollTimer: NodeJS.Timeout | null = null
  private refreshInFlight: Promise<string> | null = null

  constructor(private onState: () => void) {}

  getClientId(): string | undefined {
    return config().getClientId()
  }

  setClientId(clientId: string): void {
    config().setClientId(clientId)
    // A different application means any existing grant is meaningless.
    config().setTokens(null)
    this.cancelPolling()
    this.failure = null
    this.onState()
  }

  getTokens(): StoredTwitchTokens | null {
    return config().getTokens()
  }

  isSignedIn(): boolean {
    return config().getTokens() !== null
  }

  /**
   * Kicks off the flow and returns the code to show the user. Polling continues
   * in the background; completion is reported through onState.
   */
  async startDeviceFlow(): Promise<DeviceCodePrompt> {
    const clientId = this.getClientId()
    if (!clientId) {
      throw new TwitchAuthError(
        'No Twitch Client ID set. Register an application at https://dev.twitch.tv/console/apps ' +
          '(OAuth Redirect URL http://localhost, Client Type: Public) and paste its Client ID.'
      )
    }

    this.cancelPolling()

    const res = await postForm<DeviceCodeResponse>('/device', {
      client_id: clientId,
      scopes: SCOPES.join(' ')
    })

    const expiresAt = Date.now() + res.expires_in * 1000
    // Twitch's documented floor is 5s; never poll faster than it asks.
    const intervalMs = Math.max(res.interval, 5) * 1000

    this.poll(clientId, res.device_code, expiresAt, intervalMs)

    return {
      userCode: res.user_code,
      verificationUri: res.verification_uri,
      expiresAt,
      interval: res.interval
    }
  }

  private poll(
    clientId: string,
    deviceCode: string,
    expiresAt: number,
    intervalMs: number
  ): void {
    const tick = async (): Promise<void> => {
      if (Date.now() > expiresAt) {
        this.cancelPolling()
        this.failure = 'Device code expired before authorisation. Start again.'
        this.onState()
        return
      }

      try {
        const token = await postForm<TokenResponse>('/token', {
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
        this.cancelPolling()
        await this.persist(token)
        this.failure = null
        this.onState()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)

        if (/authorization_pending|pending/i.test(msg)) return // expected: keep waiting
        if (/slow_down/i.test(msg)) {
          // Back off and reschedule at the slower rate.
          this.cancelPolling()
          intervalMs += 5000
          this.pollTimer = setInterval(() => void tick(), intervalMs)
          return
        }

        this.cancelPolling()
        this.failure = /access_denied|denied/i.test(msg)
          ? 'Authorisation was denied in the browser.'
          : msg
        this.onState()
      }
    }

    this.pollTimer = setInterval(() => void tick(), intervalMs)
  }

  private failure: string | null = null

  getFailure(): string | null {
    return this.failure
  }

  isPending(): boolean {
    return this.pollTimer !== null
  }

  cancelPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private async persist(token: TokenResponse): Promise<void> {
    const identity = await this.validate(token.access_token)
    const scopes = Array.isArray(token.scope)
      ? token.scope
      : typeof token.scope === 'string'
        ? token.scope.split(' ')
        : identity.scopes

    config().setTokens({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scopes,
      userId: identity.user_id,
      login: identity.login
    })
  }

  private async validate(accessToken: string): Promise<ValidateResponse> {
    const res = await fetch(`${ID_BASE}/validate`, {
      headers: { Authorization: `OAuth ${accessToken}` }
    })
    if (!res.ok) throw new TwitchAuthError(`token validation failed: ${res.status}`)
    return (await res.json()) as ValidateResponse
  }

  /**
   * Single source of truth for a usable token. Concurrent callers share one
   * refresh; without that, several EventSub subscriptions starting at once
   * would each spend the refresh token and invalidate each other.
   */
  async getAccessToken(): Promise<string> {
    const tokens = config().getTokens()
    if (!tokens) throw new TwitchAuthError('Not signed in to Twitch.')

    if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) return tokens.accessToken

    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = this.refresh(tokens).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async refresh(tokens: StoredTwitchTokens): Promise<string> {
    const clientId = this.getClientId()
    if (!clientId) throw new TwitchAuthError('No Twitch Client ID set.')

    try {
      const res = await postForm<TokenResponse>('/token', {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken
      })

      config().setTokens({
        ...tokens,
        accessToken: res.access_token,
        // Twitch may or may not rotate the refresh token; keep the old one if not.
        refreshToken: res.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + res.expires_in * 1000
      })

      this.onState()
      return res.access_token
    } catch (err) {
      // A dead refresh token is unrecoverable — force a clean re-auth rather
      // than leaving every provider retrying against a token that cannot work.
      config().setTokens(null)
      this.failure = 'Twitch session expired. Sign in again.'
      this.onState()
      throw err
    }
  }

  signOut(): void {
    this.cancelPolling()
    this.failure = null
    config().setTokens(null)
    this.onState()
  }
}
