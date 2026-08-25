import type { EmoteSettings, Platform } from '@shared/types'
import type { ChatProvider, ProviderEvents } from './types'
import type { IrcHub } from '../twitch/irc'
import type { IrcMessage } from '../twitch/ircparse'
import { normalizeIrcPrivmsg, normalizeIrcUsernotice } from '../twitch/ircnormalize'
import { applyEmotes, type ThirdPartyEmotes } from '../emotes'

export interface TwitchIrcConfig {
  login: string
}

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
    private emotes: ThirdPartyEmotes,
    /** Read on every message so a toggle takes effect without reconnecting. */
    private getEmoteSettings: () => EmoteSettings
  ) {
    this.label = config.login
  }

  /** Channel emotes first, then 7TV globals. */
  private lookupEmote = (name: string): ReturnType<ThirdPartyEmotes['lookup']> =>
    this.roomId
      ? this.emotes.lookup('twitch', this.roomId, name, this.getEmoteSettings())
      : undefined

  /**
   * Every PRIVMSG and ROOMSTATE carries room-id, so the channel's numeric id
   * arrives for free — no Helix call and no sign-in needed to load its emotes.
   */
  private ensureEmotes(roomId: string | undefined): void {
    if (!roomId || this.roomId === roomId) return
    this.roomId = roomId
    void this.emotes.loadChannel('twitch', roomId)
  }

  async connect(): Promise<void> {
    this.emit.status('connecting')
    try {
      await this.hub.join(this.config.login, (msg) => this.handle(msg))
      this.joined = true
      this.emit.status('connected')
      // Anonymous IRC carries no liveness signal, and chat traffic is not one:
      // offline channels still have active chat. Report unknown rather than
      // guess.
      this.emit.live(null)
    } catch (err) {
      this.emit.status('error', err instanceof Error ? err.message : String(err))
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

  private handle(msg: IrcMessage): void {
    switch (msg.command) {
      case 'PRIVMSG': {
        this.ensureEmotes(msg.tags['room-id'])
        const chat = normalizeIrcPrivmsg(msg, this.sourceId)
        if (chat) {
          chat.fragments = applyEmotes(chat.fragments, this.lookupEmote)
          this.emit.message(chat)
        }
        return
      }

      case 'USERNOTICE': {
        this.ensureEmotes(msg.tags['room-id'])
        const notice = normalizeIrcUsernotice(msg, this.sourceId)
        if (notice) {
          notice.fragments = applyEmotes(notice.fragments, this.lookupEmote)
          this.emit.message(notice)
        }
        return
      }

      case 'CLEARMSG': {
        const targetId = msg.tags['target-msg-id']
        if (!targetId) return
        this.emit.moderation({
          type: 'delete-message',
          sourceId: this.sourceId,
          messageId: `twitch:${this.sourceId}:${targetId}`
        })
        return
      }

      case 'CLEARCHAT': {
        // A trailing parameter names the timed-out user; without one the whole
        // room was cleared.
        const target = msg.trailing
        if (target) {
          const userId = msg.tags['target-user-id']
          this.emit.moderation({
            type: 'clear-user',
            sourceId: this.sourceId,
            userId: userId ?? target
          })
        } else {
          this.emit.moderation({ type: 'clear-chat', sourceId: this.sourceId })
        }
        return
      }

      case 'ROOMSTATE': {
        // Arrives on join; confirms the channel exists and carries room-id, so
        // emotes start loading before the first message shows up.
        this.ensureEmotes(msg.tags['room-id'])
        this.emit.status('connected')
        return
      }

      case 'NOTICE': {
        const id = msg.tags['msg-id'] ?? ''
        if (id.includes('msg_channel_suspended') || id.includes('msg_banned')) {
          this.emit.status('error', msg.trailing ?? 'channel unavailable')
        }
        return
      }
    }
  }
}
