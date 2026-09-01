import { shell } from 'electron'
import type { BrowserWindow } from 'electron'
import type { AccountState, Platform } from '@shared/types'
import { KickAccount } from '../kick/auth'
import type { TwitchAuth } from '../twitch/auth'
import { twitchAccount } from '../twitch/state'
import { YouTubeAccount } from '../youtube/auth'

/** The three platforms do not share an auth mechanism, and cannot: Twitch is the only
    one offering a public-client flow, so it uses device codes with a real refresh
    token. Google wants a Cloud project and Kick wants a client secret, neither of which
    a single-user desktop build can hold — so both sign in through a window running the
    real site, exactly as an OBS browser dock does. This class is where that difference
    stops mattering to everything upstream. */
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

  /** Site sessions live in Chromium's own cookie store, so a restart already has them —
      what it does not have is who they belong to. */
  async restore(): Promise<void> {
    await Promise.allSettled([this.youtube.restore(), this.kick.restore()])
  }

  list(): AccountState[] {
    return [twitchAccount(this.twitch), this.youtube.state(), this.kick.state()]
  }

  async signIn(platform: Platform, parent: BrowserWindow | null): Promise<void> {
    if (platform === 'twitch') {
      const prompt = await this.twitch.startDeviceFlow()

      this.onChange()
      await shell.openExternal(prompt.verificationUri)
      return
    }

    if (platform === 'youtube') return this.youtube.signIn(parent)

    return this.kick.signIn(parent)
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
