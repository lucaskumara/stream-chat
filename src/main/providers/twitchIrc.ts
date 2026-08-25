import type { Platform } from '@shared/types'
import type { ChatProvider, ProviderEvents } from './types'
import type { IrcHub } from '../twitch/irc'
import type { IrcMessage } from '../twitch/ircparse'
import { normalizeIrcPrivmsg, normalizeIrcUsernotice } from '../twitch/ircnormalize'
import { applyEmotes, type ThirdPartyEmotes } from '../emotes'

export interface TwitchIrcConfig {
  login: string
}

/** NOTICE ids that mean this channel will never deliver chat. */
const FATAL_NOTICE_IDS = ['msg_channel_suspended', 'msg_banned']

/**
 * Twitch chat with no account at all. Reading anonymously means there is no
 * token, no Client ID and nothing for the user to set up — they type a channel
 * name and chat arrives.
 *
 * Compared with the EventSub provider this loses badge images and the live
 * indicator, and gains subs/raids (USERNOTICE) for free. Moderation is fully
 * covered: CLEARMSG deletes one message, CLEARCHAT with a target times a user
 * out, and CLEARCHAT alone clears the room.
 */
export class TwitchIrcProvider implements ChatProvider {
  readonly platform: Platform = 'twitch'
  label: string

  private joined = false

  /** Twitch's numeric channel id, learned from the room-id tag. */
  private roomId: string | null = null

  constructor(
    readonly sourceId: string,
    private config: TwitchIrcConfig,
    private emit: ProviderEvents,
    private hub: IrcHub,
    private emotes: ThirdPartyEmotes
  ) {
    this.label = config.login
  }

  async connect(): Promise<void> {
    this.emit.status('connecting')
    try {
      await this.hub.join(this.config.login, (message) => this.route(message))
      this.joined = true
      this.emit.status('connected')
      // Anonymous IRC carries no liveness signal, and chat traffic is not one:
      // offline channels still have active chat. Report unknown rather than
      // guess.
      this.emit.live(null)
    } catch (error) {
      this.emit.status('error', error instanceof Error ? error.message : String(error))
    }
  }

  async disconnect(): Promise<void> {
    if (this.joined) {
      this.hub.part(this.config.login)
      this.joined = false
    }
    this.emit.live(null)
    this.emit.status('disconnected')
  }

  private route(message: IrcMessage): void {
    switch (message.command) {
      case 'PRIVMSG':
        return this.emitChatMessage(message)
      case 'USERNOTICE':
        return this.emitEventMessage(message)
      case 'CLEARMSG':
        return this.emitMessageDeleted(message)
      case 'CLEARCHAT':
        return this.emitChatCleared(message)
      case 'ROOMSTATE':
        return this.confirmJoined(message)
      case 'NOTICE':
        return this.reportFatalNotice(message)
    }
  }

  private emitChatMessage(message: IrcMessage): void {
    this.ensureEmotesLoaded(message)
    const chat = normalizeIrcPrivmsg(message, this.sourceId)
    if (!chat) return
    chat.fragments = applyEmotes(chat.fragments, this.lookupEmote)
    this.emit.message(chat)
  }

  /** Subs, resubs, gifts, raids and announcements all arrive as USERNOTICE. */
  private emitEventMessage(message: IrcMessage): void {
    this.ensureEmotesLoaded(message)
    const notice = normalizeIrcUsernotice(message, this.sourceId)
    if (!notice) return
    notice.fragments = applyEmotes(notice.fragments, this.lookupEmote)
    this.emit.message(notice)
  }

  private emitMessageDeleted(message: IrcMessage): void {
    const targetMessageId = message.tags['target-msg-id']
    if (!targetMessageId) return
    this.emit.moderation({
      type: 'delete-message',
      sourceId: this.sourceId,
      // Must match how normalizeIrcPrivmsg composes ids.
      messageId: `twitch:${this.sourceId}:${targetMessageId}`
    })
  }

  private emitChatCleared(message: IrcMessage): void {
    // A trailing parameter names the timed-out user; without one the whole
    // room was cleared.
    const timedOutLogin = message.trailing
    if (!timedOutLogin) {
      this.emit.moderation({ type: 'clear-chat', sourceId: this.sourceId })
      return
    }
    this.emit.moderation({
      type: 'clear-user',
      sourceId: this.sourceId,
      userId: message.tags['target-user-id'] ?? timedOutLogin
    })
  }

  private confirmJoined(message: IrcMessage): void {
    this.ensureEmotesLoaded(message)
    this.emit.status('connected')
  }

  private reportFatalNotice(message: IrcMessage): void {
    const noticeId = message.tags['msg-id'] ?? ''
    if (!FATAL_NOTICE_IDS.some((id) => noticeId.includes(id))) return
    this.emit.status('error', message.trailing ?? 'channel unavailable')
  }

  private lookupEmote = (name: string): ReturnType<ThirdPartyEmotes['lookup']> =>
    // Always resolved, whatever the channel's switches say: fragments carry the
    // provider so the renderer can hide one live and put it back again.
    this.roomId ? this.emotes.lookup('twitch', this.roomId, name) : undefined

  /**
   * Every PRIVMSG and ROOMSTATE carries room-id, so the channel's numeric id
   * arrives for free — no Helix call and no sign-in needed to load its emotes.
   */
  private ensureEmotesLoaded(message: IrcMessage): void {
    const roomId = message.tags['room-id']
    if (!roomId || this.roomId === roomId) return
    this.roomId = roomId
    void this.emotes.loadChannel('twitch', roomId)
  }
}
