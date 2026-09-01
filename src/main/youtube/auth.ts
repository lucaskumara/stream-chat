import type { BrowserWindow } from 'electron'
import { Innertube, UniversalCache } from 'youtubei.js'
import type { AccountState } from '@shared/types'
import type { LoginTarget } from '../accounts/window'
import { forgetSession, isSignedIn, runLoginWindow, sessionFor } from '../accounts/window'

const ORIGIN = 'https://www.youtube.com'

const TARGET: LoginTarget = {
  partition: 'persist:account-youtube',
  startUrl: `https://accounts.google.com/ServiceLogin?service=youtube&continue=${encodeURIComponent(ORIGIN)}`,
  title: 'Sign in to YouTube',

  /** Google writes these on the YouTube origin only once the account is actually
      switched in, so their presence is the sign-in signal rather than page URL. */
  marker: { url: ORIGIN, names: ['SAPISID', '__Secure-3PAPISID'] }
}

interface Identity {
  displayName?: string
  handle?: string
}

export class YouTubeAccount {
  private identity: Identity | null = null
  private failure: string | null = null
  private pending = false

  constructor(private onState: () => void) {}

  async restore(): Promise<void> {
    if (!(await isSignedIn(TARGET))) return

    await this.readIdentity()
    this.onState()
  }

  async signIn(parent: BrowserWindow | null): Promise<void> {
    if (this.pending) return

    this.pending = true
    this.failure = null
    this.onState()

    try {
      const signedIn = await runLoginWindow(TARGET, parent)
      if (signedIn) await this.readIdentity()
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

    await forgetSession(TARGET)
    this.onState()
  }

  state(): AccountState {
    if (this.pending) return { platform: 'youtube', status: 'pending' }

    if (this.failure) {
      return { platform: 'youtube', status: 'error', error: this.failure }
    }

    if (!this.identity) return { platform: 'youtube', status: 'signed-out' }

    return {
      platform: 'youtube',
      status: 'signed-in',
      userId: this.identity.handle,
      displayName: this.identity.displayName,
      grants: ['same access as the website']
    }
  }

  /** The authenticated client later features will send and moderate through. Null
      when signed out, so a caller cannot mistake an anonymous session for this one. */
  async authenticated(): Promise<Innertube | null> {
    const cookie = await cookieHeader()
    if (!cookie) return null

    return Innertube.create({
      cookie,
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: false
    })
  }

  private async readIdentity(): Promise<void> {
    try {
      const youtube = await this.authenticated()
      if (!youtube) {
        this.identity = null
        return
      }

      const accounts = await youtube.account.getInfo(true)
      const active = accounts.find((item) => item.is_selected) ?? accounts[0]

      this.identity = {
        displayName: active?.account_name?.text,
        handle: active?.channel_handle?.text
      }
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error)
      this.identity = null
    }
  }
}

async function cookieHeader(): Promise<string> {
  const cookies = await sessionFor(TARGET).cookies.get({ url: ORIGIN })
  if (cookies.length === 0) return ''

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
}
