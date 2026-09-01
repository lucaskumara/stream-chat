import type { Platform } from '@shared/types'
import type { AccountIdentity } from '../accounts/session'
import { OAuthAccount } from '../accounts/session'
import type { OAuthProvider } from '../accounts/oauth'
import { BUILT_IN_KICK_CLIENT_ID, BUILT_IN_KICK_CLIENT_SECRET } from './clientId'

const API = 'https://api.kick.com/public/v1'

/** Read-only, matching Twitch and YouTube. `streamkey:read` is the one that answers the
    question this work started from — Kick documents the scope but no endpoint for it, so
    whether a key actually comes back is still unverified. `chat:write` and
    `channel:write` are deliberately absent until something can use them. */
const SCOPES = ['user:read', 'channel:read', 'streamkey:read']

const GRANTS: Record<string, string> = {
  'user:read': 'read your account',
  'channel:read': 'read your channel',
  'streamkey:read': 'stream key'
}

interface UsersResponse {
  data?: { user_id?: number; name?: string }[]
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

  protected async identify(accessToken: string): Promise<AccountIdentity> {
    const res = await fetch(`${API}/users`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    })

    if (!res.ok) throw new Error(`users answered ${res.status}`)

    const user = ((await res.json()) as UsersResponse).data?.[0]

    return {
      userId: user?.user_id === undefined ? undefined : String(user.user_id),
      displayName: user?.name
    }
  }
}
