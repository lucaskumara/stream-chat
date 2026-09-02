import { shell } from 'electron'
import type { AccountState, Platform } from '@shared/types'
import { config } from '../config'
import type { StoredTokens } from '../config'
import { LoopbackReceiver } from './loopback'
import type { OAuthProvider } from './oauth'
import { authorizeUrl, exchangeCode, refreshTokens, revokeToken } from './oauth'
import { challengeFor, createState, createVerifier, readRedirect } from './pkce'

/** One port for both providers, taken only while a sign-in is in flight. It sits beside
    the OBS link server's 4568 rather than sharing it: that one is long-lived and serves
    chat, and a redirect receiver has no business living that long. */
const PORT = 4569
const PATH = '/callback'

const CONSENT_TIMEOUT_MS = 5 * 60 * 1000

const REFRESH_MARGIN_MS = 5 * 60 * 1000

export interface AccountIdentity {
  userId?: string
  displayName?: string

  /** What to connect chat to. Separate from displayName because a display name is not an
      identifier on any platform, and on YouTube the two are nothing alike. */
  channel?: string
}

/** The authorization-code half of an account: browser, redirect, exchange, refresh. What
    a platform still owns is who its provider is, how to read an identity, and how to
    phrase what a scope grants. */
export abstract class OAuthAccount {
  abstract readonly platform: Platform

  private pending = false
  private failure: string | null = null
  private identity: AccountIdentity | null = null
  private refreshInFlight: Promise<string> | null = null

  constructor(private readonly onState: () => void) {}

  protected abstract provider(): OAuthProvider | null

  protected abstract identify(accessToken: string): Promise<AccountIdentity>

  protected abstract grantsFor(scopes: string[]): string[]

  isSignedIn(): boolean {
    return this.tokens() !== null
  }

  /** The signed-in user's own channel, which is the only chat this app opens. */
  ownChannel(): string | null {
    return this.tokens()?.channel || null
  }

  async restore(): Promise<void> {
    if (!this.tokens()) return

    await this.readIdentity()
    this.onState()
  }

  async signIn(): Promise<void> {
    const provider = this.provider()
    if (!provider || this.pending) return

    this.pending = true
    this.failure = null
    this.onState()

    const receiver = new LoopbackReceiver(PORT, PATH)

    try {
      await receiver.start()

      const verifier = createVerifier()
      const state = createState()
      const redirectUri = receiver.redirectUri(provider.redirectHost)

      await shell.openExternal(
        authorizeUrl(provider, redirectUri, challengeFor(verifier), state)
      )

      const redirect = await receiver.wait(CONSENT_TIMEOUT_MS)
      const { code, error } = readRedirect(redirect, state)

      if (error || !code) throw new Error(error ?? 'no authorization code')

      this.store(await exchangeCode(provider, code, verifier, redirectUri))
      await this.readIdentity()
    } catch (err) {
      this.failure = err instanceof Error ? err.message : String(err)
    } finally {
      receiver.close()
      this.pending = false
      this.onState()
    }
  }

  async signOut(): Promise<void> {
    const provider = this.provider()
    const held = this.tokens()

    this.identity = null
    this.failure = null

    config().setTokens(this.platform, null)
    this.onState()

    if (provider && held) await revokeToken(provider, held.refreshToken || held.accessToken)
  }

  /** The token later features will send with. Concurrent callers share one refresh —
      several starting at once would each spend the refresh token and, where the provider
      rotates it, invalidate each other. */
  async accessToken(): Promise<string | null> {
    const provider = this.provider()
    const held = this.tokens()
    if (!provider || !held) return null

    if (Date.now() < held.expiresAt - REFRESH_MARGIN_MS) return held.accessToken

    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = this.renew(provider, held).finally(() => {
      this.refreshInFlight = null
    })

    try {
      return await this.refreshInFlight
    } catch {
      return null
    }
  }

  state(): AccountState {
    if (!this.provider()) return { platform: this.platform, status: 'not-configured' }

    if (this.pending) return { platform: this.platform, status: 'pending' }

    const held = this.tokens()
    if (held) {
      return {
        platform: this.platform,
        status: 'signed-in',
        userId: held.userId || undefined,
        displayName: held.login || undefined,
        grants: this.grantsFor(held.scopes)
      }
    }

    if (this.failure) {
      return { platform: this.platform, status: 'error', error: this.failure }
    }

    return { platform: this.platform, status: 'signed-out' }
  }

  private tokens(): StoredTokens | null {
    return config().getTokens(this.platform)
  }

  private store(tokens: {
    accessToken: string
    refreshToken: string
    expiresAt: number
    scopes: string[]
  }): void {
    const known = this.identity

    config().setTokens(this.platform, {
      ...tokens,
      userId: known?.userId ?? '',
      login: known?.displayName ?? '',
      channel: known?.channel
    })
  }

  private async renew(provider: OAuthProvider, held: StoredTokens): Promise<string> {
    try {
      const fresh = await refreshTokens(provider, held.refreshToken)

      config().setTokens(this.platform, {
        ...fresh,
        userId: held.userId,
        login: held.login,
        channel: held.channel
      })

      this.onState()
      return fresh.accessToken
    } catch (err) {
      config().setTokens(this.platform, null)
      this.failure = `${this.platform} session expired. Sign in again.`
      this.onState()
      throw err
    }
  }

  /** The name is decoration; the token is the account. A lookup that fails leaves the
      sign-in intact and unnamed rather than throwing away a good token. */
  private async readIdentity(): Promise<void> {
    const held = this.tokens()
    if (!held) return

    try {
      const token = await this.accessToken()
      if (!token) return

      this.identity = await this.identify(token)

      config().setTokens(this.platform, {
        ...held,
        userId: this.identity.userId ?? held.userId,
        login: this.identity.displayName ?? held.login,
        channel: this.identity.channel ?? held.channel
      })
    } catch (err) {
      console.warn(`[accounts] ${this.platform} identity lookup failed:`, err)
    }
  }
}
