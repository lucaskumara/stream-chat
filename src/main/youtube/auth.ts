import type { Platform } from '@shared/types'
import type { AccountIdentity } from '../accounts/session'
import { OAuthAccount } from '../accounts/session'
import type { OAuthProvider } from '../accounts/oauth'
import { BUILT_IN_YOUTUBE_CLIENT_ID, BUILT_IN_YOUTUBE_CLIENT_SECRET } from './clientId'

const API = 'https://www.googleapis.com/youtube/v3'

/** Read-only, matching the Twitch decision: asking for write authority before anything
    can use it buys nothing but a scarier consent screen. Sending and going live will
    need `youtube.force-ssl`, and one more sign-in. */
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly']

const GRANTS: Record<string, string> = {
  'https://www.googleapis.com/auth/youtube.readonly': 'read your channel'
}

interface ChannelList {
  items?: { id?: string; snippet?: { title?: string } }[]
}

export class YouTubeAccount extends OAuthAccount {
  readonly platform: Platform = 'youtube'

  protected provider(): OAuthProvider | null {
    const clientId = process.env['YOUTUBE_CLIENT_ID'] || BUILT_IN_YOUTUBE_CLIENT_ID
    if (!clientId) return null

    return {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',

      clientId,
      clientSecret:
        process.env['YOUTUBE_CLIENT_SECRET'] || BUILT_IN_YOUTUBE_CLIENT_SECRET || undefined,

      scopes: SCOPES,
      redirectHost: '127.0.0.1',

      /** Without both of these Google returns an access token and no refresh token, and
          the account silently falls out an hour later. */
      extraAuthParams: { access_type: 'offline', prompt: 'consent' }
    }
  }

  protected grantsFor(scopes: string[]): string[] {
    return scopes.map((scope) => GRANTS[scope]).filter((grant): grant is string => !!grant)
  }

  /** One unit of quota. The whole point of the Data API here is calls like this one —
      low-frequency and account-scoped — while chat reading stays anonymous. */
  protected async identify(accessToken: string): Promise<AccountIdentity> {
    const res = await fetch(`${API}/channels?part=snippet&mine=true`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    if (!res.ok) throw new Error(`channels.list answered ${res.status}`)

    const channel = ((await res.json()) as ChannelList).items?.[0]

    return { userId: channel?.id, displayName: channel?.snippet?.title }
  }
}
