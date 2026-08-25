import type { AddSourceRequest, Platform, SourceState } from '@shared/types'
import type { MessageBus } from './bus'
import type { ChatProvider, ProviderEvents } from './providers/types'
import { MockProvider } from './providers/mock'

interface Entry {
  provider: ChatProvider
  state: SourceState
}

/**
 * Owns the set of connected channels. Providers are constructed here and given
 * an emit object wired straight to the bus, so a provider never needs to know
 * about IPC or the renderer.
 */
export class SourceManager {
  private entries = new Map<string, Entry>()
  private seq = 0

  constructor(
    private bus: MessageBus,
    private onStateChange: (states: SourceState[]) => void
  ) {}

  list(): SourceState[] {
    return [...this.entries.values()].map((e) => ({ ...e.state }))
  }

  async add(req: AddSourceRequest): Promise<string> {
    const sourceId = `src-${++this.seq}`

    const state: SourceState = {
      id: sourceId,
      platform: req.platform,
      label: req.label || req.platform,
      status: 'disconnected',
      live: false
    }

    const provider = this.createProvider(sourceId, req, state)
    this.entries.set(sourceId, { provider, state })
    this.onStateChange(this.list())

    try {
      await provider.connect()
    } catch (err) {
      state.status = 'error'
      state.error = err instanceof Error ? err.message : String(err)
      this.onStateChange(this.list())
    }

    return sourceId
  }

  async remove(sourceId: string): Promise<void> {
    const entry = this.entries.get(sourceId)
    if (!entry) return
    // Drop it from the map first so a provider that emits during teardown
    // can't resurrect a row the user just removed.
    this.entries.delete(sourceId)
    this.bus.dropSource(sourceId)
    await entry.provider.disconnect().catch(() => undefined)
    this.onStateChange(this.list())
  }

  /** Mock provider only: retune synthetic traffic without reconnecting. */
  setRate(sourceId: string, rate: number): void {
    const provider = this.entries.get(sourceId)?.provider
    if (provider instanceof MockProvider) provider.setRate(rate)
  }

  async disconnectAll(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(entries.map((e) => e.provider.disconnect().catch(() => undefined)))
  }

  private createProvider(
    sourceId: string,
    req: AddSourceRequest,
    state: SourceState
  ): ChatProvider {
    const emit: ProviderEvents = {
      message: (msg) => this.bus.push(msg),
      moderation: (evt) => this.bus.pushModeration(evt),
      status: (status, error) => {
        state.status = status
        state.error = error
        this.onStateChange(this.list())
      },
      live: (live) => {
        state.live = live
        this.onStateChange(this.list())
      }
    }

    const platform: Platform = req.platform
    switch (platform) {
      case 'mock':
        return new MockProvider(sourceId, { rate: req.rate, label: req.label }, emit)
      case 'twitch':
      case 'youtube':
      case 'kick':
        throw new Error(`Provider not implemented yet: ${platform}`)
      default: {
        const never: never = platform
        throw new Error(`Unknown platform: ${String(never)}`)
      }
    }
  }
}
