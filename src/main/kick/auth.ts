import type { BrowserWindow } from 'electron'
import type { AccountState } from '@shared/types'
import type { LoginTarget } from '../accounts/window'
import { forgetSession, isSignedIn, runLoginWindow, sessionFor } from '../accounts/window'

const ORIGIN = 'https://kick.com'

const TARGET: LoginTarget = {
  partition: 'persist:account-kick',
  startUrl: ORIGIN,
  title: 'Sign in to Kick',

  /** Only `session_token`. Kick hands every visitor a `kick_session`, so matching that
      one too would report a signed-in account the moment the window opened. */
  marker: { url: ORIGIN, names: ['session_token'] },

  width: 1000,
  height: 800
}

interface ApiUser {
  id?: number
  username?: string
  streamer_channel?: { slug?: string }
}

interface Identity {
  userId?: string
  displayName?: string
}

export class KickAccount {
  private identity: Identity | null = null
  private failure: string | null = null
  private pending = false
  private connected = false

  constructor(private onState: () => void) {}

  async restore(): Promise<void> {
    if (!(await isSignedIn(TARGET))) return

    this.connected = true
    await this.readIdentity()
    this.onState()
  }

  async signIn(parent: BrowserWindow | null): Promise<void> {
    if (this.pending) return

    this.pending = true
    this.failure = null
    this.onState()

    try {
      this.connected = await runLoginWindow(TARGET, parent)
      if (this.connected) await this.readIdentity()
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error)
    } finally {
      this.pending = false
      this.onState()
    }
  }

  async signOut(): Promise<void> {
    this.identity = null
    this.failure = null
    this.connected = false

    await forgetSession(TARGET)
    this.onState()
  }

  state(): AccountState {
    if (this.pending) return { platform: 'kick', status: 'pending' }

    if (this.failure) {
      return { platform: 'kick', status: 'error', error: this.failure }
    }

    if (!this.connected) return { platform: 'kick', status: 'signed-out' }

    return {
      platform: 'kick',
      status: 'signed-in',
      userId: this.identity?.userId,
      displayName: this.identity?.displayName,
      grants: ['same access as the website']
    }
  }

  /** Requests issued through the login partition rather than Node's fetch, so they
      carry Chromium's TLS fingerprint and the Cloudflare clearance cookie the login
      window already earned. A bare fetch with the same cookies is refused. */
  fetch(path: string, init?: RequestInit): Promise<Response> {
    return sessionFor(TARGET).fetch(`${ORIGIN}${path}`, init)
  }

  /** A name is a nicety; the session is what matters. A failed lookup leaves the
      account connected and unnamed rather than reporting a sign-in failure. */
  private async readIdentity(): Promise<void> {
    try {
      const response = await this.fetch('/api/v1/user', {
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) return

      const user = (await response.json()) as ApiUser

      this.identity = {
        userId: user.id === undefined ? undefined : String(user.id),
        displayName: user.username ?? user.streamer_channel?.slug
      }
    } catch {
      this.identity = null
    }
  }
}
