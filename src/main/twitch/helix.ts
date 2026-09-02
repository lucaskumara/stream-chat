import type { TwitchAuth } from './auth'

const HELIX = 'https://api.twitch.tv/helix'

export interface HelixUser {
  id: string
  login: string
  display_name: string
  profile_image_url: string
}

interface SendChatMessageResult {
  message_id?: string
  is_sent?: boolean
  drop_reason?: { code?: string; message?: string }
}

export class HelixError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export class Helix {
  constructor(private auth: TwitchAuth) {}

  private async request<T>(
    path: string,
    init?: RequestInit & { retryOn401?: boolean }
  ): Promise<T> {
    const clientId = this.auth.getClientId()
    if (!clientId) throw new HelixError('No Twitch Client ID set.', 0)

    const token = await this.auth.getAccessToken()
    const res = await fetch(`${HELIX}${path}`, {
      ...init,
      headers: {
        'Client-Id': clientId,
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers
      }
    })

    if (res.status === 204) return undefined as T

    const text = await res.text()
    if (!res.ok) {
      let message = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string }
        message = parsed.message || parsed.error || message
      } catch {
      }
      throw new HelixError(message, res.status)
    }

    return text ? (JSON.parse(text) as T) : (undefined as T)
  }

  async getUserByLogin(login: string): Promise<HelixUser | null> {
    const clean = login.trim().toLowerCase().replace(/^@/, '')
    if (!/^[a-z0-9_]{1,25}$/.test(clean)) {
      throw new HelixError(`"${login}" is not a valid Twitch channel name.`, 0)
    }
    const data = await this.request<{ data: HelixUser[] }>(
      `/users?login=${encodeURIComponent(clean)}`
    )
    return data.data[0] ?? null
  }

  async createEventSubSubscription(
    type: string,
    version: string,
    condition: Record<string, string>,
    sessionId: string
  ): Promise<string> {
    const data = await this.request<{ data: { id: string }[] }>('/eventsub/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        type,
        version,
        condition,
        transport: { method: 'websocket', session_id: sessionId }
      })
    })
    const id = data.data[0]?.id
    if (!id) throw new HelixError(`subscription ${type} returned no id`, 0)
    return id
  }

  /** `sender_id` has to be the token's own user, which is the whole reason a user access
      token with `user:write:chat` needs nothing else — the "verified bot or moderator"
      requirement people quote applies to app access tokens, not this path. Twitch answers
      200 with `is_sent: false` when it drops a message (a channel in followers-only mode,
      say), so a 200 is not on its own proof that anything was said. */
  async sendChatMessage(
    broadcasterId: string,
    senderId: string,
    message: string,
    replyParentMessageId?: string
  ): Promise<void> {
    const data = await this.request<{ data: SendChatMessageResult[] }>('/chat/messages', {
      method: 'POST',
      body: JSON.stringify({
        broadcaster_id: broadcasterId,
        sender_id: senderId,
        message,
        ...(replyParentMessageId ? { reply_parent_message_id: replyParentMessageId } : {})
      })
    })

    const result = data.data[0]
    if (result && result.is_sent === false) {
      throw new HelixError(result.drop_reason?.message || 'Twitch dropped the message', 0)
    }
  }

  async deleteEventSubSubscription(id: string): Promise<void> {
    await this.request<void>(`/eventsub/subscriptions?id=${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }
}
