export type Platform = 'twitch' | 'youtube' | 'kick'

export const PLATFORMS: readonly Platform[] = ['twitch', 'youtube', 'kick']

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
  label: string

  id?: string

  url?: string
  srcSet?: string
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

  badges?: Badge[]

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

export interface SourceState {
  id: string
  platform: Platform

  label: string
  status: SourceStatus

  error?: string
}

export interface ChatBatch {
  messages: ChatMessage[]
  moderation: ModerationEvent[]
}

export interface AddSourceRequest {
  platform: Platform
  label: string
  identifier?: string
}

export type AccountStatus =
  | 'not-configured'
  | 'signed-out'
  | 'pending'
  | 'signed-in'
  | 'error'

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

export interface AccountState {
  platform: Platform
  status: AccountStatus

  userId?: string
  displayName?: string

  /** What this connection unlocks, phrased for the settings row. Main resolves it
      because only main knows whether a scope was actually granted. */
  grants?: string[]

  error?: string

  /** A working sign-in that predates a scope this build now asks for. The account still
      functions; what it cannot do is whatever the new scope was for. */
  needsReauth?: boolean

  /** Twitch is the only platform with a public-client OAuth flow, so it is the only
      one that shows a code. The other two redirect back to a loopback listener. */
  prompt?: DeviceCodePrompt
}

export type HostPlatform = 'darwin' | 'win32' | 'linux' | 'other'

export interface ChatApi {
  readonly platform: HostPlatform

  listSources(): Promise<SourceState[]>
  addSource(req: AddSourceRequest): Promise<string>
  removeSource(sourceId: string): Promise<void>
  reorderSources(orderedIds: string[]): Promise<void>
  sourceBacklog(sourceId: string): Promise<ChatMessage[]>
  sendMessage(sourceId: string, text: string): Promise<void>
  watchChannel(platform: Platform, identifier: string | null): Promise<void>
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>

  obsLink(sourceId: string): Promise<string | null>

  windowMinimize(): Promise<void>
  windowToggleMaximize(): Promise<void>
  windowClose(): Promise<void>
  windowIsMaximized(): Promise<boolean>

  onWindowMaximized(cb: (maximized: boolean) => void): () => void

  onBatch(cb: (batch: ChatBatch) => void): () => void

  onSources(cb: (states: SourceState[]) => void): () => void

  accounts(): Promise<AccountState[]>
  accountSignIn(platform: Platform): Promise<void>
  accountSignOut(platform: Platform): Promise<void>

  onAccounts(cb: (states: AccountState[]) => void): () => void
}
