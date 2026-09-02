import { shell } from 'electron'
import type { AccountState, Platform } from '@shared/types'
import { KickAccount } from '../kick/auth'
import type { TwitchAuth } from '../twitch/auth'
import { twitchAccount } from '../twitch/state'
import { YouTubeAccount } from '../youtube/auth'

/** Every platform signs in through its own documented OAuth flow, and every one of them
    opens the user's real browser: Twitch by device code, because it is the only one with
    a public-client grant; YouTube and Kick by authorization code with PKCE onto a
    loopback redirect, which is what Google and Kick each document for installed apps.
    Nothing here ever sees a password, and no credential is scraped from a page. This
    class is where the difference between the two shapes stops mattering upstream. */
export class AccountManager {
  private readonly youtube: YouTubeAccount
  private readonly kick: KickAccount

  constructor(
    private readonly twitch: TwitchAuth,
    private readonly onChange: () => void
  ) {
    this.youtube = new YouTubeAccount(onChange)
    this.kick = new KickAccount(onChange)
  }

  /** Tokens survive a restart in the encrypted config; the identity behind them does
      not, so it is re-read once at boot. */
  async restore(): Promise<void> {
    await Promise.allSettled([this.youtube.restore(), this.kick.restore()])
  }

  list(): AccountState[] {
    return [twitchAccount(this.twitch), this.youtube.state(), this.kick.state()]
  }

  /** The signed-in user's own channel per platform, which is the only chat this app
      opens. Null means signed out, or signed in but not yet identified. */
  ownChannel(platform: Platform): string | null {
    if (platform === 'twitch') return this.twitch.ownChannel()
    if (platform === 'youtube') return this.youtube.ownChannel()

    return this.kick.ownChannel()
  }

  async signIn(platform: Platform): Promise<void> {
    if (platform === 'twitch') {
      try {
        const prompt = await this.twitch.startDeviceFlow()

        this.onChange()
        await shell.openExternal(prompt.verificationUri)
      } catch (error) {
        this.twitch.reportFailure(error instanceof Error ? error.message : String(error))
        this.onChange()
      }
      return
    }

    if (platform === 'youtube') return this.youtube.signIn()

    return this.kick.signIn()
  }

  async signOut(platform: Platform): Promise<void> {
    if (platform === 'twitch') {
      this.twitch.signOut()
      return
    }

    if (platform === 'youtube') return this.youtube.signOut()

    return this.kick.signOut()
  }

  /** Reached by nothing yet. Sending, moderating and reading a stream key all need an
      authenticated client, and this is where each will get one. */
  authenticated(): { youtube: YouTubeAccount; kick: KickAccount } {
    return { youtube: this.youtube, kick: this.kick }
  }
}
