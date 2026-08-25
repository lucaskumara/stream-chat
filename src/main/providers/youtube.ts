import type { Platform } from '@shared/types'
import type { ChatProvider, ProviderEvents } from './types'
import { classifyIdentifier, resolveLiveChat, type YouTubeRef } from '../youtube/resolve'
import { fetchLiveChat, readContinuation, type InnertubeClient } from '../youtube/innertube'
import { normalizeAction } from '../youtube/normalize'
import type { YtAction } from '../youtube/types'
import { applyEmotes, type ThirdPartyEmotes } from '../emotes'
import { reconnectDelayMs } from '../net/backoff'

const OFFLINE_RECHECK_MS = 120_000
const OFFLINE_JITTER_MS = 30_000
const MIN_POLL_MS = 250
const POLL_CEILING_MS = 500
const SEEN_LIMIT = 1000
const MAX_POLL_FAILURES = 3

export interface YouTubeConfig {
  identifier: string
}

export class YouTubeProvider implements ChatProvider {
  readonly platform: Platform = 'youtube'
  label: string

  private ref: YouTubeRef
  private client: InnertubeClient | null = null
  private continuation: string | null = null
  private channelId: string | null = null

  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private failures = 0
  private seen = new RecentIds(SEEN_LIMIT)

  constructor(
    readonly sourceId: string,
    config: YouTubeConfig,
    private emit: ProviderEvents,
    private emotes: ThirdPartyEmotes
  ) {
    this.ref = classifyIdentifier(config.identifier)
    this.label = this.ref.value
  }

  async connect(): Promise<void> {
    this.stopped = false
    this.emit.status('connecting')
    await this.resolve()
  }

  async disconnect(): Promise<void> {
    this.stopped = true
    this.clearTimer()
    this.continuation = null
    this.emit.live(null)
    this.emit.status('disconnected')
  }

  private async resolve(): Promise<void> {
    if (this.stopped) return

    const outcome = await resolveLiveChat(this.ref)
    if (this.stopped) return

    switch (outcome.state) {
      case 'live': {
        const { session } = outcome
        this.client = session.client
        this.continuation = session.continuation
        this.failures = 0
        if (session.author) this.label = session.author
        this.trackChannel(session.channelId)

        this.emit.status('connected')
        this.emit.live(true)
        await this.poll()
        return
      }

      case 'offline': {
        this.continuation = null
        this.emit.live(false)
        this.emit.status('offline', outcome.message)
        this.later(() => void this.resolve(), offlineRecheckDelay())
        return
      }

      case 'missing': {
        this.emit.live(false)
        this.emit.status('error', outcome.message)
        return
      }

      case 'unreachable': {
        this.emit.live(null)
        this.emit.status('error', outcome.message)
        this.later(() => void this.resolve(), reconnectDelayMs(this.failures++))
        return
      }
    }
  }

  private async poll(): Promise<void> {
    const client = this.client
    const continuation = this.continuation
    if (this.stopped || !client || !continuation) return

    try {
      const response = await fetchLiveChat(client, continuation)
      if (this.stopped) return

      const chat = response.continuationContents?.liveChatContinuation
      const next = readContinuation(chat?.continuations)
      if (!chat || !next) return this.streamEnded()

      this.failures = 0
      this.dispatch(chat.actions ?? [])
      this.continuation = next.token
      this.later(() => void this.poll(), clamp(next.timeoutMs, MIN_POLL_MS, POLL_CEILING_MS))
    } catch (error) {
      if (this.stopped) return
      this.failures++

      if (this.failures < MAX_POLL_FAILURES) {
        this.later(() => void this.poll(), reconnectDelayMs(this.failures))
        return
      }

      this.emit.status('error', error instanceof Error ? error.message : String(error))
      this.later(() => void this.resolve(), reconnectDelayMs(this.failures))
    }
  }

  private streamEnded(): void {
    this.continuation = null
    this.emit.live(false)
    this.emit.status('offline', 'the stream ended')
    this.later(() => void this.resolve(), offlineRecheckDelay())
  }

  private dispatch(actions: YtAction[]): void {
    for (const action of actions) {
      const normalized = normalizeAction(action, this.sourceId)
      if (!normalized) continue

      if (normalized.moderation) this.emit.moderation(normalized.moderation)
      if (!normalized.message || !this.seen.add(normalized.message.id)) continue

      normalized.message.fragments = applyEmotes(normalized.message.fragments, this.lookupEmote)
      this.emit.message(normalized.message)
    }
  }

  private lookupEmote = (name: string): ReturnType<ThirdPartyEmotes['lookup']> =>
    this.channelId ? this.emotes.lookup('google', this.channelId, name) : undefined

  private trackChannel(channelId: string): void {
    if (!channelId || this.channelId === channelId) return
    this.channelId = channelId
    void this.emotes.loadChannel('google', channelId)
  }

  private later(task: () => void, delayMs: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      task()
    }, delayMs)
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

function offlineRecheckDelay(): number {
  return OFFLINE_RECHECK_MS + Math.round(Math.random() * OFFLINE_JITTER_MS)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

class RecentIds {
  private ids = new Set<string>()
  private order: string[] = []

  constructor(private limit: number) {}

  add(id: string): boolean {
    if (this.ids.has(id)) return false

    this.ids.add(id)
    this.order.push(id)
    if (this.order.length > this.limit) {
      for (const evicted of this.order.splice(0, this.order.length - this.limit)) {
        this.ids.delete(evicted)
      }
    }
    return true
  }
}
