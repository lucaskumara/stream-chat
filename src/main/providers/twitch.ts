import type { Platform } from '@shared/types'
import type { ChatProvider, ProviderEvents } from './types'
import type { TwitchAuth } from '../twitch/auth'
import type { BadgeCache, Helix } from '../twitch/helix'
import type { EventSubHub } from '../twitch/eventsub'
import { normalizeChatMessage, type TwitchChatEvent } from '../twitch/normalize'
import { applyEmotes, type ThirdPartyEmotes } from '../emotes'
import { ignoreTeardownFailure } from '../lifecycle'
import type { SubscriptionRequest } from '../twitch/eventsub'

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
/**
 * Reading any channel's chat needs only user:read:chat on our own account — no
 * moderator status — which is what makes "add a channel by name" work.
 */
function buildSubscriptions(broadcasterId: string, viewerId: string): SubscriptionRequest[] {
  const chatCondition = { broadcaster_user_id: broadcasterId, user_id: viewerId }
  const streamCondition = { broadcaster_user_id: broadcasterId }

  return [
    { type: 'channel.chat.message', version: '1', condition: chatCondition },
    { type: 'channel.chat.message_delete', version: '1', condition: chatCondition },
    { type: 'channel.chat.clear_user_messages', version: '1', condition: chatCondition },
    { type: 'channel.chat.clear', version: '1', condition: chatCondition },
    { type: 'stream.online', version: '1', condition: streamCondition },
    { type: 'stream.offline', version: '1', condition: streamCondition }
  ]
}

export class TwitchProvider implements ChatProvider {
  readonly platform: Platform = 'twitch'
  label: string

  private registered = false
  private broadcasterId: string | null = null

  constructor(
    readonly sourceId: string,
    private config: TwitchProviderConfig,
    private emit: ProviderEvents,
    private deps: TwitchDeps
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
      const channel = await this.resolveChannel()
      if (!channel) return

      const viewerId = this.deps.auth.getTokens()?.userId
      if (!viewerId) {
        this.emit.status('error', 'Twitch session is missing a user id. Sign in again.')
        return
      }

      await this.deps.hub.register(
        this.sourceId,
        buildSubscriptions(channel.id, viewerId),
        (type, event) => this.route(type, event)
      )
      this.registered = true
      this.emit.status('connected')

      // Subscriptions persist while the channel is offline, so chat simply
      // starts flowing when they go live.
      this.emit.live(await this.deps.helix.isLive(channel.id))
    } catch (error) {
      this.emit.status('error', error instanceof Error ? error.message : String(error))
    }
  }

  /** Resolves the login to a channel and warms its cosmetics. Null if missing. */
  private async resolveChannel(): Promise<{ id: string } | null> {
    const user = await this.deps.helix.getUserByLogin(this.config.login)
    if (!user) {
      this.emit.status('error', `Twitch channel "${this.config.login}" does not exist.`)
      return null
    }

    this.label = user.display_name || user.login
    this.broadcasterId = user.id

    // Cosmetic: never allowed to fail a connection.
    await this.deps.badges.load(user.id)
    void this.deps.seventv.loadChannel('twitch', user.id)

    return { id: user.id }
  }

  async disconnect(): Promise<void> {
    if (this.registered) {
      await this.deps.hub
        .unregister(this.sourceId)
        .catch(ignoreTeardownFailure(`eventsub registration ${this.sourceId}`))
      this.registered = false
    }
    this.emit.live(false)
    this.emit.status('disconnected')
  }

  private route(type: string, event: Record<string, unknown>): void {
    switch (type) {
      case 'channel.chat.message':
        return this.emitChatMessage(event)
      case 'channel.chat.message_delete':
        return this.emitMessageDeleted(event)
      case 'channel.chat.clear_user_messages':
        return this.emitUserCleared(event)
      case 'channel.chat.clear':
        return this.emit.moderation({ type: 'clear-chat', sourceId: this.sourceId })
      case 'stream.online':
        return this.emit.live(true)
      case 'stream.offline':
        return this.emit.live(false)
    }
  }

  private emitChatMessage(event: Record<string, unknown>): void {
    const chat = normalizeChatMessage(
      event as unknown as TwitchChatEvent,
      this.sourceId,
      this.deps.badges
    )
    const broadcasterId = this.broadcasterId
    if (broadcasterId) {
      chat.fragments = applyEmotes(chat.fragments, (name) =>
        this.deps.seventv.lookup('twitch', broadcasterId, name)
      )
    }
    this.emit.message(chat)
  }

  private emitMessageDeleted(event: Record<string, unknown>): void {
    const messageId = event['message_id']
    if (typeof messageId !== 'string') return
    this.emit.moderation({
      type: 'delete-message',
      sourceId: this.sourceId,
      // Must match how normalizeChatMessage composes ids.
      messageId: `twitch:${this.sourceId}:${messageId}`
    })
  }

  private emitUserCleared(event: Record<string, unknown>): void {
    const userId = event['target_user_id']
    if (typeof userId !== 'string') return
    this.emit.moderation({ type: 'clear-user', sourceId: this.sourceId, userId })
  }
}
