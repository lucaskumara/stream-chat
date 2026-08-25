import type { ChatMessage, Platform } from '@shared/types'
import { MOCK_PLATFORMS, makeMockMessage, pick } from '@shared/mockdata'
import type { ChatProvider, ProviderEvents } from './types'

export interface MockConfig {
  /** Messages per second across all simulated chatters. */
  rate?: number
  platform?: Platform
  label?: string
}

/** How many recent messages to retain for reply/timeout targets. */
const RECENT_WINDOW = 40

/**
 * Generates synthetic traffic so the UI can be built and load-tested before any
 * OAuth flow exists. Rate is tunable at runtime up to the burst levels a large
 * channel produces, and it emits the moderation events the hide/delete UI
 * depends on so those paths are exercised without a real moderator.
 */
export class MockProvider implements ChatProvider {
  readonly platform: Platform
  readonly label: string

  private timer: NodeJS.Timeout | null = null
  private modTimer: NodeJS.Timeout | null = null
  private seq = 0
  private rate: number
  private recent: ChatMessage[] = []

  constructor(
    readonly sourceId: string,
    config: MockConfig,
    private emit: ProviderEvents
  ) {
    this.platform = config.platform ?? pick(MOCK_PLATFORMS)
    this.label = config.label ?? `mock/${this.platform}`
    this.rate = config.rate ?? 5
  }

  async connect(): Promise<void> {
    this.emit.status('connecting')
    await new Promise((r) => setTimeout(r, 200))
    this.emit.status('connected')
    this.emit.live(true)

    this.startTicker()
    // Moderation is rare relative to chat, so it gets its own slow timer rather
    // than a probability roll on every message.
    this.modTimer = setInterval(() => this.emitModeration(), 7000)
  }

  async disconnect(): Promise<void> {
    this.stopTicker()
    if (this.modTimer) clearInterval(this.modTimer)
    this.modTimer = null
    this.recent = []
    this.emit.live(false)
    this.emit.status('disconnected')
  }

  /** Live rate change for load testing; no reconnect required. */
  setRate(rate: number): void {
    this.rate = Math.max(0, rate)
    if (this.timer) {
      this.stopTicker()
      this.startTicker()
    }
  }

  private startTicker(): void {
    if (this.rate <= 0) return

    // Above ~50/sec a 1-message-per-tick timer hits setInterval's floor, so
    // emit in bursts on a fixed tick instead of shrinking the interval.
    const tickMs = 50
    const perTick = Math.max(1, Math.round((this.rate * tickMs) / 1000))
    const intervalMs = this.rate >= 20 ? tickMs : Math.round(1000 / this.rate)
    const burst = this.rate >= 20 ? perTick : 1

    this.timer = setInterval(() => {
      for (let i = 0; i < burst; i++) this.push()
    }, intervalMs)
  }

  private stopTicker(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private push(): void {
    const msg = makeMockMessage({
      sourceId: this.sourceId,
      platform: this.platform,
      seq: this.seq++,
      recent: this.recent
    })

    this.recent.push(msg)
    if (this.recent.length > RECENT_WINDOW) this.recent.shift()

    this.emit.message(msg)
  }

  private emitModeration(): void {
    if (this.recent.length === 0) return
    const roll = Math.random()
    const target = pick(this.recent)

    if (roll < 0.6) {
      this.emit.moderation({
        type: 'delete-message',
        sourceId: this.sourceId,
        messageId: target.id
      })
    } else if (roll < 0.95) {
      this.emit.moderation({
        type: 'clear-user',
        sourceId: this.sourceId,
        userId: target.authorId
      })
    } else {
      this.emit.moderation({ type: 'clear-chat', sourceId: this.sourceId })
      this.recent = []
    }
  }
}
