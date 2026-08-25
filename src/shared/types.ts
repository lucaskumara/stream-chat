export type Platform = 'twitch' | 'youtube' | 'kick' | 'mock'

export type EmoteProvider = 'native' | '7tv' | 'bttv'

export type Fragment =
  | { kind: 'text'; text: string }
  | {
      kind: 'emote'

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
  id: string

  sourceId: string
  platform: Platform
  kind: MessageKind
  authorId: string
  authorName: string

  authorDisplayName?: string

  authorColor?: string
  badges: Badge[]
  fragments: Fragment[]

  plainText: string

  timestamp: number

  replyTo?: { messageId: string; authorName: string; excerpt: string }

  monetary?: { amount: number; currency: string; tier?: string }
}

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

export interface EmoteSettings {
  sevenTv: boolean

  bttv: boolean
}

export const DEFAULT_EMOTE_SETTINGS: EmoteSettings = { sevenTv: true, bttv: true }

export interface SourceState {
  id: string
  platform: Platform

  label: string
  status: SourceStatus

  error?: string

  live: boolean | null
  emotes: EmoteSettings
}

export interface ChatBatch {
  messages: ChatMessage[]
  moderation: ModerationEvent[]
}

export interface AddSourceRequest {
  platform: Platform
  label: string

  rate?: number

  identifier?: string
}

export type TwitchAuthStatus =
  | 'not-configured'
  | 'signed-out'
  | 'pending'
  | 'signed-in'
  | 'error'

export interface TwitchAuthState {
  status: TwitchAuthStatus

  login?: string
  userId?: string
  error?: string
  scopes?: string[]
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export interface ChatApi {
  listSources(): Promise<SourceState[]>
  addSource(req: AddSourceRequest): Promise<string>
  removeSource(sourceId: string): Promise<void>
  setRate(sourceId: string, rate: number): Promise<void>
  setEmoteSettings(sourceId: string, settings: EmoteSettings): Promise<void>
  openExternal(url: string): Promise<void>

  onBatch(cb: (batch: ChatBatch) => void): () => void

  onSources(cb: (states: SourceState[]) => void): () => void

  twitchAuthState(): Promise<TwitchAuthState>
  twitchStartLogin(): Promise<DeviceCodePrompt>
  twitchSignOut(): Promise<void>

  onTwitchAuth(cb: (state: TwitchAuthState) => void): () => void
}
