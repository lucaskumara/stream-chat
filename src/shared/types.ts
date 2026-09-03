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

/** What a platform needs to be useful: a channel to read chat from, and where to push
    video. The stream key is a secret and never leaves the main process — the renderer is
    told only whether one is set. */
export interface PlatformSetup {
  channel: string
  ingestUrl: string
  streamKey: string

  /** Whether to forward the OBS stream here. Persisted, so it survives a restart and the
      relay is listening again before the user thinks to check. */
  forward: boolean
}

export type PlatformPatch = Partial<PlatformSetup>

export interface PlatformConfig {
  platform: Platform
  channel: string
  ingestUrl: string
  hasStreamKey: boolean
  forward: boolean
}

/** Twitch publishes one global ingest for everybody and YouTube's is fixed, so both are
    prefilled. Kick runs on Amazon IVS, which gives every channel its own ingest host, so
    there is nothing to prefill and no API to ask. */
export const DEFAULT_INGEST: Record<Platform, string> = {
  twitch: 'rtmps://ingest.global-contribute.live-video.net/app/',
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  kick: ''
}

/** Per platform, independent of whether OBS is sending: `off` is switched off, `error` is
    a platform that refused us or fell behind. */
export type DestinationState = 'off' | 'connecting' | 'sending' | 'error'

export interface Destination {
  platform: Platform
  state: DestinationState
  error?: string
}

export interface BroadcastState {
  /** The two values to paste into OBS -> Settings -> Stream -> Custom. */
  obsServer: string
  obsKey: string

  /** Whether the app is accepting a push at all, and whether OBS is actually sending one.
      The two are separate: the relay listens from launch, so a signal can be reported
      before any platform has been switched on. */
  listening: boolean
  receiving: boolean

  /** Seconds between keyframes in the incoming stream, measured as it arrives. Kick runs
      on Amazon IVS, which requires 2s and will accept a push without ever going live if
      the interval is longer — so this is the difference between a baffling silent failure
      and a sentence telling the user what to change. */
  keyframeSeconds?: number

  destinations: Destination[]
  error?: string
}

/** What IVS requires. Twitch and YouTube are looser but recommend the same. */
export const REQUIRED_KEYFRAME_SECONDS = 2

export type HostPlatform = 'darwin' | 'win32' | 'linux' | 'other'

export interface ChatApi {
  readonly platform: HostPlatform

  listSources(): Promise<SourceState[]>
  addSource(req: AddSourceRequest): Promise<string>
  removeSource(sourceId: string): Promise<void>
  reorderSources(orderedIds: string[]): Promise<void>
  sourceBacklog(sourceId: string): Promise<ChatMessage[]>
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

  platforms(): Promise<PlatformConfig[]>
  savePlatform(platform: Platform, patch: PlatformPatch): Promise<void>

  onPlatforms(cb: (configs: PlatformConfig[]) => void): () => void

  broadcast(): Promise<BroadcastState>

  onBroadcast(cb: (state: BroadcastState) => void): () => void
}
