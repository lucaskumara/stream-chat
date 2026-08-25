import type { ChatMessage, ModerationEvent, Platform, SourceStatus } from '@shared/types'

export interface ProviderEvents {
  message(msg: ChatMessage): void
  moderation(evt: ModerationEvent): void
  status(status: SourceStatus, error?: string): void
  live(live: boolean): void
}

/**
 * One instance per connected channel. Implementations own their own reconnect
 * logic — a dropped Twitch socket must not tear down YouTube.
 */
export interface ChatProvider {
  readonly sourceId: string
  readonly platform: Platform
  /** Mutable: providers may resolve a nicer display name during connect. */
  label: string
  connect(): Promise<void>
  disconnect(): Promise<void>
}

export type ProviderFactory = (
  sourceId: string,
  config: Record<string, unknown>,
  emit: ProviderEvents
) => ChatProvider
