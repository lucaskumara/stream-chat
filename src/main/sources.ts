import type { AddSourceRequest, EmoteSettings, Platform, SourceState } from '@shared/types'
import { DEFAULT_EMOTE_SETTINGS } from '@shared/types'
import type { MessageBus } from './bus'
import type { ChatProvider, ProviderEvents } from './providers/types'
import { MockProvider } from './providers/mock'
import { TwitchProvider, type TwitchDeps } from './providers/twitch'
import { TwitchIrcProvider } from './providers/twitchIrc'
import type { IrcHub } from './twitch/irc'
import type { ThirdPartyEmotes } from './emotes'
import { config } from './config'
import { ignoreTeardownFailure } from './lifecycle'

interface Entry {
  provider: ChatProvider
  state: SourceState
  /** The login/slug the user added, kept separate from the display label:
   *  a provider may replace label with a display name that differs in case or
   *  script, and persistence must key off the stable identifier. */
  identifier?: string
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
    private onStateChange: (states: SourceState[]) => void,
    private twitch: TwitchDeps,
    private irc: IrcHub,
    private seventv: ThirdPartyEmotes
  ) {}

  list(): SourceState[] {
    return [...this.entries.values()].map((e) => ({ ...e.state }))
  }

  async add(request: AddSourceRequest): Promise<string> {
    const sourceId = `src-${++this.seq}`
    const identifier = request.identifier?.toLowerCase()
    const state = this.buildInitialState(sourceId, request, identifier)

    const provider = this.createProvider(sourceId, request, state)
    this.entries.set(sourceId, { provider, state, identifier })
    this.onStateChange(this.list())

    try {
      await provider.connect()
      // Providers may discover their real display name during connect.
      if (provider.label) state.label = provider.label
      this.rememberIfConnected(request, identifier, state)
    } catch (error) {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    }

    this.onStateChange(this.list())
    return sourceId
  }

  private buildInitialState(
    sourceId: string,
    request: AddSourceRequest,
    identifier: string | undefined
  ): SourceState {
    const state: SourceState = {
      id: sourceId,
      platform: request.platform,
      label: request.label || request.identifier || request.platform,
      status: 'disconnected',
      live: false,
      emotes: { ...DEFAULT_EMOTE_SETTINGS }
    }

    // Restore saved switches so a channel keeps its preference across restarts.
    const saved = identifier
      ? config().getChannels().find(
          (channel) => channel.platform === request.platform && channel.login === identifier
        )?.emotes
      : undefined
    if (saved) state.emotes = { ...saved }

    return state
  }

  /** Only remember channels that actually connected, so a typo is not retried forever. */
  private rememberIfConnected(
    request: AddSourceRequest,
    identifier: string | undefined,
    state: SourceState
  ): void {
    if (request.platform !== 'twitch' || !identifier) return
    if (state.status !== 'connected') return
    config().addChannel({ platform: 'twitch', login: identifier, emotes: state.emotes })
  }

  async remove(sourceId: string): Promise<void> {
    const entry = this.entries.get(sourceId)
    if (!entry) return
    // Drop it from the map first so a provider that emits during teardown
    // can't resurrect a row the user just removed.
    this.entries.delete(sourceId)
    this.bus.dropSource(sourceId)

    if (entry.state.platform === 'twitch' && entry.identifier) {
      config().removeChannel('twitch', entry.identifier)
    }

    await entry.provider.disconnect().catch(ignoreTeardownFailure(`source ${sourceId}`))
    this.onStateChange(this.list())
  }

  /** Used on sign-out: tear down every source belonging to one platform. */
  async removeByPlatform(platform: Platform): Promise<void> {
    const doomed = [...this.entries.values()].filter((e) => e.state.platform === platform)
    for (const entry of doomed) {
      this.entries.delete(entry.state.id)
      this.bus.dropSource(entry.state.id)
      await entry.provider.disconnect().catch(ignoreTeardownFailure(entry.state.id))
    }
    this.onStateChange(this.list())
  }

  setEmoteSettings(sourceId: string, settings: EmoteSettings): void {
    const entry = this.entries.get(sourceId)
    if (!entry) return
    // Mutating the same object the provider's getter reads means the change
    // applies to the very next message, with no reconnect.
    entry.state.emotes = { ...settings }
    if (entry.state.platform === 'twitch' && entry.identifier) {
      config().setChannelEmotes('twitch', entry.identifier, entry.state.emotes)
    }
    this.onStateChange(this.list())
  }

  /** Mock provider only: retune synthetic traffic without reconnecting. */
  setRate(sourceId: string, rate: number): void {
    const provider = this.entries.get(sourceId)?.provider
    if (provider instanceof MockProvider) provider.setRate(rate)
  }

  /** Reconnect channels saved from a previous run, once auth is available. */
  async restoreSaved(): Promise<void> {
    for (const channel of config().getChannels()) {
      if (this.entries.size >= 20) break
      const already = [...this.entries.values()].some(
        (e) => e.state.platform === channel.platform && e.identifier === channel.login
      )
      if (already) continue
      await this.add({ platform: channel.platform, label: channel.login, identifier: channel.login })
    }
  }

  async disconnectAll(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()
    await Promise.all(
      entries.map((entry) =>
        entry.provider.disconnect().catch(ignoreTeardownFailure(entry.state.id))
      )
    )
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

      case 'twitch': {
        const login = (req.identifier ?? '').toLowerCase()
        // Anonymous by default so a channel can be added with no account at
        // all. Signing in is an optional upgrade: EventSub adds badge images
        // and a real live indicator.
        return this.twitch.auth.isSignedIn()
          ? new TwitchProvider(sourceId, { login }, emit, this.twitch)
          : new TwitchIrcProvider(sourceId, { login }, emit, this.irc, this.seventv)
      }

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
