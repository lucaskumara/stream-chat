import type { AddSourceRequest, Platform, SourceState } from '@shared/types'
import type { MessageBus } from './bus'
import {
  createWatcher,
  type ChatWatcher,
  type ChatWatcherEvents,
  type PlatformServices
} from './chat'
import { MissingChannelError } from './chat/channel'
import { ignoreTeardownFailure } from './lifecycle'

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

    this.entries.set(sourceId, { watcher, state })
    this.onStateChange(this.list())

    try {
      await watcher.connect()

      if (watcher.label) state.label = watcher.label
    } catch (error) {
      if (error instanceof MissingChannelError) {
        await this.remove(sourceId)
        throw error
      }

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
    this.onStateChange(this.list())
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
}
