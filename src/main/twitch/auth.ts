import { config, type StoredTokens } from '../config'

const ID_BASE = 'https://id.twitch.tv/oauth2'

/** Read-only. Sending and going live need write scopes, and asking for them before
    those features exist would be requesting authority we cannot use — at the cost of
    one more sign-in when they land. */
export const SCOPES = ['user:read:chat', 'channel:read:stream_key'] as const

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

    throw new TwitchAuthError(
      rec.message || rec.error_description || rec.error || `${res.status}`
    )
  }

  return body as T
}

export class TwitchAuth {
  private pollTimer: NodeJS.Timeout | null = null
  private refreshInFlight: Promise<string> | null = null

  constructor(private onState: () => void) {}

  getClientId(): string | undefined {
    return config().getClientId()
  }

  getTokens(): StoredTokens | null {
    return config().getTokens('twitch')
  }

  isSignedIn(): boolean {
    return config().getTokens('twitch') !== null
  }

  async startDeviceFlow(): Promise<DeviceCodePrompt> {
    const clientId = this.getClientId()
    if (!clientId) {
      throw new TwitchAuthError('This build has no Twitch Client ID compiled in.')
    }

    this.cancelPolling()

    const res = await postForm<DeviceCodeResponse>('/device', {
      client_id: clientId,
      scopes: SCOPES.join(' ')
    })

    const expiresAt = Date.now() + res.expires_in * 1000

    const intervalMs = Math.max(res.interval, 5) * 1000

    this.poll(clientId, res.device_code, expiresAt, intervalMs)

    this.prompt = {
      userCode: res.user_code,
      verificationUri: res.verification_uri,
      expiresAt,
      interval: res.interval
    }

    return this.prompt
  }

  private prompt: DeviceCodePrompt | null = null

  /** Retained so the settings row can keep showing the code while polling runs — the
      renderer never has to hold a value main is already tracking. */
  getPrompt(): DeviceCodePrompt | null {
    return this.pollTimer ? this.prompt : null
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

        if (/authorization_pending|pending/i.test(msg)) return
        if (/slow_down/i.test(msg)) {
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

  /** Starting the flow can fail before any polling exists to carry the error — a dead
      id.twitch.tv, a refused client id — and that has to reach the settings row rather
      than rejecting an IPC call nobody is watching. */
  reportFailure(message: string): void {
    this.cancelPolling()
    this.failure = message
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

    config().setTokens('twitch', {
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

  async getAccessToken(): Promise<string> {
    const tokens = config().getTokens('twitch')
    if (!tokens) throw new TwitchAuthError('Not signed in to Twitch.')

    if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) return tokens.accessToken

    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = this.refresh(tokens).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  private async refresh(tokens: StoredTokens): Promise<string> {
    const clientId = this.getClientId()
    if (!clientId) throw new TwitchAuthError('No Twitch Client ID set.')

    try {
      const res = await postForm<TokenResponse>('/token', {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken
      })

      config().setTokens('twitch', {
        ...tokens,
        accessToken: res.access_token,

        refreshToken: res.refresh_token || tokens.refreshToken,
        expiresAt: Date.now() + res.expires_in * 1000
      })

      this.onState()
      return res.access_token
    } catch (err) {
      config().setTokens('twitch', null)
      this.failure = 'Twitch session expired. Sign in again.'
      this.onState()
      throw err
    }
  }

  signOut(): void {
    this.cancelPolling()
    this.failure = null
    config().setTokens('twitch', null)
    this.onState()
  }
}
