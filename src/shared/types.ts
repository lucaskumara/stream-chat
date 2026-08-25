export type Platform = 'twitch' | 'youtube' | 'kick' | 'mock'

/**
 * Messages arrive pre-split into fragments so the renderer never parses text.
 * Twitch/YouTube both hand us emote positions; re-deriving them by regex in the
 * UI would break on overlapping emote names and unicode offsets.
 */
/** Which service supplied an emote, so the UI can hide one source live. */
export type EmoteProvider = 'native' | '7tv' | 'bttv'

export type Fragment =
  | { kind: 'text'; text: string }
  | {
      kind: 'emote'
      /** The original word. Rendered as text when its provider is switched off. */
      name: string
      url: string
      srcSet?: string
      provider?: EmoteProvider
    }
  | { kind: 'mention'; text: string; userId?: string }
  | { kind: 'link'; text: string; href: string }

export interface Badge {
  id: string
  label: string
  url?: string
}

export type MessageKind =
  | 'chat'
  | 'system'
  | 'subscription'
  | 'donation'
  | 'raid'
  | 'announcement'

export interface ChatMessage {
  /** Globally unique: `${platform}:${sourceId}:${platformMessageId}` */
  id: string
  /** Which connected source produced this, so combined view can attribute it. */
  sourceId: string
  platform: Platform
  kind: MessageKind
  authorId: string
  authorName: string
  /** Localised/display name where it differs from login name (Twitch, YouTube). */
  authorDisplayName?: string
  /** Hex colour chosen by the user on their platform, if any. */
  authorColor?: string
  badges: Badge[]
  fragments: Fragment[]
  /** Flattened text, kept for filter matching and search without walking fragments. */
  plainText: string
  /** Epoch ms from the platform where available, else receipt time. */
  timestamp: number
  /** Set when this message replies to another. */
  replyTo?: { messageId: string; authorName: string; excerpt: string }
  /** Money attached to the message: bits, Super Chat, Kick gifts. */
  monetary?: { amount: number; currency: string; tier?: string }
}

/** Out-of-band moderation events. Applied to already-rendered messages. */
export type ModerationEvent =
  | { type: 'delete-message'; sourceId: string; messageId: string }
  | { type: 'clear-user'; sourceId: string; userId: string }
  | { type: 'clear-chat'; sourceId: string }

export type SourceStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'error'

/** Per-channel third-party emote switches. */
export interface EmoteSettings {
  sevenTv: boolean
  /** Twitch-only: BTTV keys channels by Twitch user id. */
  bttv: boolean
}

export const DEFAULT_EMOTE_SETTINGS: EmoteSettings = { sevenTv: true, bttv: true }

export interface SourceState {
  id: string
  platform: Platform
  /** Human label: channel name. */
  label: string
  status: SourceStatus
  /** Populated when status is 'error'. */
  error?: string
  /**
   * True/false when the transport can actually tell, null when it cannot.
   * Anonymous Twitch has no liveness signal — chat flows whether or not the
   * channel is broadcasting — so guessing from traffic would be a lie.
   */
  live: boolean | null
  emotes: EmoteSettings
}

/** Main -> renderer, batched. */
export interface ChatBatch {
  messages: ChatMessage[]
  moderation: ModerationEvent[]
}

/* ------------------------------------------------------------------ *
 * Renderer-facing configuration
 * ------------------------------------------------------------------ */

export interface AddSourceRequest {
  platform: Platform
  label: string
  /** Mock provider only: synthetic messages per second. */
  rate?: number
  /**
   * Channel identifier for real platforms: a Twitch login, a Kick slug, or a
   * YouTube handle/channel id/video id. Produced by parseChannelInput.
   */
  identifier?: string
}

/** 'not-configured' means the build lacks a Client ID — a packaging fault. */
export type TwitchAuthStatus =
  | 'not-configured'
  | 'signed-out'
  | 'pending'
  | 'signed-in'
  | 'error'

export interface TwitchAuthState {
  status: TwitchAuthStatus
  /** Present when signed in. */
  login?: string
  userId?: string
  error?: string
  scopes?: string[]
}

/** Shown to the user during Device Code Flow. */
export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export type RuleField = 'any' | 'author' | 'text'
export type RuleAction = 'highlight' | 'hide'

/**
 * Filter/highlight rules are evaluated in the renderer at render time rather
 * than on ingest, so editing a rule re-styles scrollback instead of only
 * affecting messages that arrive afterwards.
 */
export interface Rule {
  id: string
  enabled: boolean
  action: RuleAction
  field: RuleField
  pattern: string
  isRegex: boolean
  caseSensitive: boolean
  /** Highlight rules only: left-border / tint colour. */
  color?: string
  /** Restrict the rule to one platform. */
  platform?: Platform
}

export type ViewMode = 'panes' | 'combined'

/**
 * The complete surface the preload exposes on `window.api`. Declared here so
 * the preload implementation and the renderer consumer are checked against one
 * contract, and so a browser-only dev harness can implement the same shape.
 */
export interface ChatApi {
  listSources(): Promise<SourceState[]>
  addSource(req: AddSourceRequest): Promise<string>
  removeSource(sourceId: string): Promise<void>
  setRate(sourceId: string, rate: number): Promise<void>
  setEmoteSettings(sourceId: string, settings: EmoteSettings): Promise<void>
  openExternal(url: string): Promise<void>
  /** Returns an unsubscribe function. */
  onBatch(cb: (batch: ChatBatch) => void): () => void
  /** Returns an unsubscribe function. */
  onSources(cb: (states: SourceState[]) => void): () => void

  /* ---- Twitch auth ---- */
  twitchAuthState(): Promise<TwitchAuthState>
  twitchStartLogin(): Promise<DeviceCodePrompt>
  twitchSignOut(): Promise<void>
  /** Returns an unsubscribe function. */
  onTwitchAuth(cb: (state: TwitchAuthState) => void): () => void
}
