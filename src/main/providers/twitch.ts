import type { EmoteSettings, Platform } from '@shared/types'
import type { ChatProvider, ProviderEvents } from './types'
import type { TwitchAuth } from '../twitch/auth'
import type { BadgeCache, Helix } from '../twitch/helix'
import type { EventSubHub } from '../twitch/eventsub'
import { normalizeChatMessage, type TwitchChatEvent } from '../twitch/normalize'
import { applyEmotes, type ThirdPartyEmotes } from '../emotes'

export interface TwitchProviderConfig {
  /** Lowercased channel login, as typed by the user. */
  login: string
}

export interface TwitchDeps {
  auth: TwitchAuth
  helix: Helix
  hub: EventSubHub
  badges: BadgeCache
  seventv: ThirdPartyEmotes
}

/**
 * One channel's chat. Subscribes to chat plus the moderation events the hide
 * feature needs, and to stream.online/offline so the channel reconnects itself
 * when the broadcaster goes live.
 *
 * Reconnect and session handling live in EventSubHub; this class only owns the
 * lifecycle of its own subscriptions.
 */
export class TwitchProvider implements ChatProvider {
  readonly platform: Platform = 'twitch'
  label: string

  private registered = false
  private broadcasterId: string | null = null

  constructor(
    readonly sourceId: string,
    private config: TwitchProviderConfig,
    private emit: ProviderEvents,
    private deps: TwitchDeps,
    private getEmoteSettings: () => EmoteSettings
  ) {
    this.label = config.login
  }

  async connect(): Promise<void> {
    this.emit.status('connecting')

    if (!this.deps.auth.isSignedIn()) {
      this.emit.status('error', 'Sign in to Twitch first.')
      return
    }

    try {
      const user = await this.deps.helix.getUserByLogin(this.config.login)
      if (!user) {
        this.emit.status('error', `Twitch channel "${this.config.login}" does not exist.`)
        return
      }

      this.label = user.display_name || user.login

      this.broadcasterId = user.id

      // Cosmetic, and deliberately not awaited into the failure path.
      await this.deps.badges.load(user.id)
      void this.deps.seventv.loadChannel('twitch', user.id)

      const self = this.deps.auth.getTokens()?.userId
      if (!self) {
        this.emit.status('error', 'Twitch session is missing a user id. Sign in again.')
        return
      }

      const condition = { broadcaster_user_id: user.id, user_id: self }

      await this.deps.hub.register(
        this.sourceId,
        [
          // Reading any channel's chat needs only user:read:chat on our own
          // account — no moderator status — which is what makes "add by name" work.
          { type: 'channel.chat.message', version: '1', condition },
          { type: 'channel.chat.message_delete', version: '1', condition },
          { type: 'channel.chat.clear_user_messages', version: '1', condition },
          { type: 'channel.chat.clear', version: '1', condition },
          {
            type: 'stream.online',
            version: '1',
            condition: { broadcaster_user_id: user.id }
          },
          {
            type: 'stream.offline',
            version: '1',
            condition: { broadcaster_user_id: user.id }
          }
        ],
        (type, event) => this.handle(type, event)
      )

      this.registered = true
      this.emit.status('connected')

      // Subscriptions persist while the channel is offline, so chat simply
      // starts flowing when they go live.
      const live = await this.deps.helix.isLive(user.id)
      this.emit.live(live)
    } catch (err) {
      this.emit.status('error', err instanceof Error ? err.message : String(err))
    }
  }

  async disconnect(): Promise<void> {
    if (this.registered) {
      await this.deps.hub.unregister(this.sourceId).catch(() => undefined)
      this.registered = false
    }
    this.emit.live(false)
    this.emit.status('disconnected')
  }

  private handle(type: string, event: Record<string, unknown>): void {
    switch (type) {
      case 'channel.chat.message': {
        const chat = normalizeChatMessage(
          event as unknown as TwitchChatEvent,
          this.sourceId,
          this.deps.badges
        )
        const broadcasterId = this.broadcasterId
        if (broadcasterId) {
          chat.fragments = applyEmotes(chat.fragments, (name) =>
            this.deps.seventv.lookup('twitch', broadcasterId, name, this.getEmoteSettings())
          )
        }
        this.emit.message(chat)
        return
      }

      case 'channel.chat.message_delete': {
        const messageId = event['message_id']
        if (typeof messageId !== 'string') return
        this.emit.moderation({
          type: 'delete-message',
          sourceId: this.sourceId,
          // Must match how normalizeChatMessage composes ids.
          messageId: `twitch:${this.sourceId}:${messageId}`
        })
        return
      }

      case 'channel.chat.clear_user_messages': {
        const userId = event['target_user_id']
        if (typeof userId !== 'string') return
        this.emit.moderation({ type: 'clear-user', sourceId: this.sourceId, userId })
        return
      }

      case 'channel.chat.clear': {
        this.emit.moderation({ type: 'clear-chat', sourceId: this.sourceId })
        return
      }

      case 'stream.online': {
        this.emit.live(true)
        return
      }

      case 'stream.offline': {
        this.emit.live(false)
        return
      }
    }
  }
}
