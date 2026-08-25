import type { AddSourceRequest, EmoteSettings, Platform, SourceState } from '@shared/types'
import { DEFAULT_EMOTE_SETTINGS } from '@shared/types'
import type { MessageBus } from './bus'
import type { ChatProvider, ProviderEvents } from './providers/types'
import { MockProvider } from './providers/mock'
import { TwitchProvider, type TwitchDeps } from './providers/twitch'
import { TwitchIrcProvider } from './providers/twitchIrc'
import { YouTubeProvider } from './providers/youtube'
import type { IrcHub } from './twitch/irc'
import type { ThirdPartyEmotes } from './emotes'
import { config, type StoredPlatform } from './config'
import { ignoreTeardownFailure } from './lifecycle'

const PERSISTED_PLATFORMS: StoredPlatform[] = ['twitch', 'youtube']

const PERSISTABLE_STATUSES = new Set(['connected', 'offline'])

function persistedPlatform(platform: Platform): StoredPlatform | null {
  return PERSISTED_PLATFORMS.find((candidate) => candidate === platform) ?? null
}

function normalizeIdentifier(platform: Platform, identifier: string | undefined): string | undefined {
  const trimmed = identifier?.trim()
  if (!trimmed) return undefined
  return platform === 'youtube' ? trimmed : trimmed.toLowerCase()
}

interface Entry {
  provider: ChatProvider
  state: SourceState

  identifier?: string
}

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

  async add(incoming: AddSourceRequest): Promise<string> {
    const sourceId = `src-${++this.seq}`
    const identifier = normalizeIdentifier(incoming.platform, incoming.identifier)
    const request: AddSourceRequest = { ...incoming, identifier }
    const state = this.buildInitialState(sourceId, request, identifier)

    const provider = this.createProvider(sourceId, request, state)
    this.entries.set(sourceId, { provider, state, identifier })
    this.onStateChange(this.list())

    try {
      await provider.connect()

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

    const saved = identifier
      ? config().getChannels().find(
          (channel) => channel.platform === request.platform && channel.login === identifier
        )?.emotes
      : undefined
    if (saved) state.emotes = { ...saved }

    return state
  }

  private rememberIfConnected(
    request: AddSourceRequest,
    identifier: string | undefined,
    state: SourceState
  ): void {
    const platform = persistedPlatform(request.platform)
    if (!platform || !identifier) return
    if (!PERSISTABLE_STATUSES.has(state.status)) return
    config().addChannel({ platform, login: identifier, emotes: state.emotes })
  }

  async remove(sourceId: string): Promise<void> {
    const entry = this.entries.get(sourceId)
    if (!entry) return

    this.entries.delete(sourceId)
    this.bus.dropSource(sourceId)

    const persisted = persistedPlatform(entry.state.platform)
    if (persisted && entry.identifier) config().removeChannel(persisted, entry.identifier)

    await entry.provider.disconnect().catch(ignoreTeardownFailure(`source ${sourceId}`))
    this.onStateChange(this.list())
  }

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

    entry.state.emotes = { ...settings }
    const persisted = persistedPlatform(entry.state.platform)
    if (persisted && entry.identifier) {
      config().setChannelEmotes(persisted, entry.identifier, entry.state.emotes)
    }
    this.onStateChange(this.list())
  }

  setRate(sourceId: string, rate: number): void {
    const provider = this.entries.get(sourceId)?.provider
    if (provider instanceof MockProvider) provider.setRate(rate)
  }

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

        return this.twitch.auth.isSignedIn()
          ? new TwitchProvider(sourceId, { login }, emit, this.twitch)
          : new TwitchIrcProvider(sourceId, { login }, emit, this.irc, this.seventv)
      }

      case 'youtube':
        return new YouTubeProvider(
          sourceId,
          { identifier: req.identifier ?? '' },
          emit,
          this.seventv
        )

      case 'kick':
        throw new Error(`Provider not implemented yet: ${platform}`)

      default: {
        const never: never = platform
        throw new Error(`Unknown platform: ${String(never)}`)
      }
    }
  }
}
