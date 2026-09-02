import type { Platform } from '@shared/types'
import type { AccountIdentity } from '../accounts/session'
import { OAuthAccount } from '../accounts/session'
import type { OAuthProvider } from '../accounts/oauth'
import { BUILT_IN_KICK_CLIENT_ID, BUILT_IN_KICK_CLIENT_SECRET } from './clientId'

const API = 'https://api.kick.com/public/v1'

/** `streamkey:read` is deliberately *not* requested. Kick documents the scope, but its
    OpenAPI spec carries no endpoint that returns a stream key — asking for it would put a
    permission on the consent screen that nothing can spend. It goes back the day Kick
    ships the endpoint. `channel:write` waits on the same rule until metadata lands. */
const SCOPES = ['user:read', 'channel:read', 'chat:write']

const GRANTS: Record<string, string> = {
  'user:read': 'read your account',
  'channel:read': 'read your channel',
  'chat:write': 'send chat'
}

interface UsersResponse {
  data?: { user_id?: number; name?: string }[]
}

interface ChannelsResponse {
  data?: { broadcaster_user_id?: number; slug?: string }[]
}

export class KickAccount extends OAuthAccount {
  readonly platform: Platform = 'kick'

  protected provider(): OAuthProvider | null {
    const clientId = process.env['KICK_CLIENT_ID'] || BUILT_IN_KICK_CLIENT_ID
    const clientSecret = process.env['KICK_CLIENT_SECRET'] || BUILT_IN_KICK_CLIENT_SECRET

    /** Kick's token exchange rejects a request with no secret, so a build carrying only
        the id would offer a sign-in that cannot complete. Better to read as unconfigured. */
    if (!clientId || !clientSecret) return null

    return {
      authorizeUrl: 'https://id.kick.com/oauth/authorize',
      tokenUrl: 'https://id.kick.com/oauth/token',
      revokeUrl: 'https://id.kick.com/oauth/revoke',

      clientId,
      clientSecret,

      scopes: SCOPES,

      /** `localhost`, not `127.0.0.1`: Kick's frontend rewrites the first `127.0.0.1` it
          finds in the URL, and the redirect_uri then no longer matches the registered
          one. Their docs describe a sacrificial-parameter workaround; using localhost
          avoids needing it. */
      redirectHost: 'localhost'
    }
  }

  protected grantsFor(scopes: string[]): string[] {
    return scopes.map((scope) => GRANTS[scope]).filter((grant): grant is string => !!grant)
  }

  /** `/channels` with no parameters is documented as returning the authenticated user's
      own channel, which is where the slug comes from — the slug is what chat connects to,
      and it is not always the username. The name is a separate, optional nicety. */
  protected async identify(accessToken: string): Promise<AccountIdentity> {
    const channel = (
      await this.read<ChannelsResponse>('/channels', accessToken)
    ).data?.[0]

    if (!channel?.slug) throw new Error('Kick returned no channel for this account')

    const user = await this.read<UsersResponse>('/users', accessToken).catch(() => null)

    return {
      userId:
        channel.broadcaster_user_id === undefined
          ? undefined
          : String(channel.broadcaster_user_id),
      displayName: user?.data?.[0]?.name ?? channel.slug,
      channel: channel.slug
    }
  }

  private async read<T>(path: string, accessToken: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    })

    if (!res.ok) throw new Error(`Kick ${path} answered ${res.status}`)

    return (await res.json()) as T
  }

  /** Sending needs the target channel's own `broadcaster_user_id`, and the id on the
      chat-side `KickChannel` comes from a different (internal) API — assuming the two
      match would be a guess. This asks the public API by slug instead, cached because a
      channel's id does not change while it is open. */
  private readonly broadcasterIds = new Map<string, number>()

  async broadcasterId(slug: string): Promise<number | null> {
    const known = this.broadcasterIds.get(slug)
    if (known !== undefined) return known

    const token = await this.accessToken()
    if (!token) return null

    const found = (
      await this.read<ChannelsResponse>(`/channels?slug=${encodeURIComponent(slug)}`, token)
    ).data?.[0]?.broadcaster_user_id

    if (found === undefined) return null

    this.broadcasterIds.set(slug, found)
    return found
  }

  /** 200 with `is_sent: false` is Kick accepting the call and dropping the message, the
      same trap Twitch has — a plain `res.ok` check would clear the composer on a message
      nobody saw. */
  async sendChatMessage(broadcasterUserId: number, content: string): Promise<void> {
    const token = await this.accessToken()
    if (!token) throw new Error('Sign in to Kick to send messages.')

    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        type: 'user',
        content,
        broadcaster_user_id: broadcasterUserId
      })
    })

    const body = (await res.json().catch(() => null)) as {
      data?: { is_sent?: boolean }
      message?: string
    } | null

    if (!res.ok) throw new Error(body?.message || `Kick answered ${res.status}`)

    if (body?.data?.is_sent === false) {
      throw new Error(body.message || 'Kick dropped the message')
    }
  }
}
