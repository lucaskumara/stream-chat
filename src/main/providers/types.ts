import type { ChatMessage, ModerationEvent, Platform, SourceStatus } from '@shared/types'

export interface ProviderEvents {
  message(msg: ChatMessage): void
  moderation(evt: ModerationEvent): void
  status(status: SourceStatus, error?: string): void
  live(live: boolean | null): void
}

export interface ChatProvider {
  readonly sourceId: string
  readonly platform: Platform

  label: string
  connect(): Promise<void>
  disconnect(): Promise<void>
}
