import type { AddSourceRequest, Platform, SourceState } from '@shared/types'
import type { MessageBus } from './bus'
import {
  createWatcher,
  type ChatWatcher,
  type ChatWatcherEvents,
  type PlatformServices
} from './chat'
import { config, type StoredChannel, type StoredPlatform } from './config'
import { ignoreTeardownFailure } from './lifecycle'

const MAX_RESTORED_SOURCES = 20

const PERSISTED_PLATFORMS: StoredPlatform[] = ['twitch', 'youtube', 'kick']

const PERSISTABLE_STATUSES = new Set(['connected', 'offline'])

function persistedPlatform(platform: Platform): StoredPlatform | null {
  return PERSISTED_PLATFORMS.find((candidate) => candidate === platform) ?? null
}

function normalizeIdentifier(
  platform: Platform,
  identifier: string | undefined
): string | undefined {
  const trimmed = identifier?.trim()
  if (!trimmed) return undefined

  return platform === 'youtube' ? trimmed : trimmed.toLowerCase()
}

interface Entry {
  watcher: ChatWatcher
  state: SourceState

  identifier?: string
}

export class SourceManager {
  private entries = new Map<string, Entry>()
  private seq = 0

  constructor(
    private bus: MessageBus,
    private onStateChange: (states: SourceState[]) => void,
    private services: PlatformServices
  ) {}

  list(): SourceState[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.state }))
  }

  async add(incoming: AddSourceRequest): Promise<string> {
    const sourceId = `src-${++this.seq}`
    const identifier = normalizeIdentifier(incoming.platform, incoming.identifier)
    const request: AddSourceRequest = { ...incoming, identifier }
    const state = this.buildInitialState(sourceId, request)

    const watcher = createWatcher(
      request.platform,
      { sourceId, identifier: identifier ?? '', events: this.eventsFor(state) },
      this.services
    )

    this.entries.set(sourceId, { watcher, state, identifier })
    this.onStateChange(this.list())

    try {
      await watcher.connect()

      if (watcher.label) state.label = watcher.label
      this.rememberIfConnected(request, identifier, state)
    } catch (error) {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
    }

    this.onStateChange(this.list())
    return sourceId
  }

  async remove(sourceId: string): Promise<void> {
    const entry = this.entries.get(sourceId)
    if (!entry) return

    this.entries.delete(sourceId)
    this.bus.dropSource(sourceId)

    const persisted = persistedPlatform(entry.state.platform)
    if (persisted && entry.identifier) config().removeChannel(persisted, entry.identifier)

    await entry.watcher.disconnect().catch(ignoreTeardownFailure(`source ${sourceId}`))
    this.onStateChange(this.list())
  }

  async removeByPlatform(platform: Platform): Promise<void> {
    const doomed = [...this.entries.values()].filter((entry) => entry.state.platform === platform)

    for (const entry of doomed) {
      this.entries.delete(entry.state.id)
      this.bus.dropSource(entry.state.id)
      await entry.watcher.disconnect().catch(ignoreTeardownFailure(entry.state.id))
    }

    this.onStateChange(this.list())
  }

  reorder(orderedIds: string[]): void {
    const pending = new Map(this.entries)
    const reordered = new Map<string, Entry>()

    for (const sourceId of orderedIds) {
      const entry = pending.get(sourceId)
      if (!entry) continue

      reordered.set(sourceId, entry)
      pending.delete(sourceId)
    }

    for (const [sourceId, entry] of pending) reordered.set(sourceId, entry)

    this.entries = reordered
    config().setChannels(this.reorderedChannels())
    this.onStateChange(this.list())
  }

  async restoreSaved(): Promise<void> {
    for (const channel of config().getChannels()) {
      if (this.entries.size >= MAX_RESTORED_SOURCES) break

      const already = [...this.entries.values()].some(
        (entry) => entry.state.platform === channel.platform && entry.identifier === channel.login
      )
      if (already) continue

      await this.add({
        platform: channel.platform,
        label: channel.login,
        identifier: channel.login
      })
    }
  }

  async disconnectAll(): Promise<void> {
    const entries = [...this.entries.values()]
    this.entries.clear()

    await Promise.all(
      entries.map((entry) => entry.watcher.disconnect().catch(ignoreTeardownFailure(entry.state.id)))
    )
  }

  private eventsFor(state: SourceState): ChatWatcherEvents {
    return {
      message: (message) => this.bus.push(message),
      moderation: (event) => this.bus.pushModeration(event),
      status: (status, error) => {
        state.status = status
        state.error = error

        const label = this.entries.get(state.id)?.watcher.label
        if (label) state.label = label

        this.onStateChange(this.list())
      }
    }
  }

  private buildInitialState(sourceId: string, request: AddSourceRequest): SourceState {
    return {
      id: sourceId,
      platform: request.platform,
      label: request.label || request.identifier || request.platform,
      status: 'disconnected'
    }
  }

  private rememberIfConnected(
    request: AddSourceRequest,
    identifier: string | undefined,
    state: SourceState
  ): void {
    const platform = persistedPlatform(request.platform)
    if (!platform || !identifier) return
    if (!PERSISTABLE_STATUSES.has(state.status)) return

    config().addChannel({ platform, login: identifier })
  }

  private reorderedChannels(): StoredChannel[] {
    const saved = config().getChannels()
    const ordered: StoredChannel[] = []

    for (const entry of this.entries.values()) {
      const platform = persistedPlatform(entry.state.platform)
      if (!platform || !entry.identifier) continue

      const match = saved.find(
        (channel) => channel.platform === platform && channel.login === entry.identifier
      )
      if (match && !ordered.includes(match)) ordered.push(match)
    }

    for (const channel of saved) {
      if (!ordered.includes(channel)) ordered.push(channel)
    }

    return ordered
  }
}
