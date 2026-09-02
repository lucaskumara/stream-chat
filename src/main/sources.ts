import type { AddSourceRequest, Platform, SourceState } from '@shared/types'
import { obsMatchKey } from '@shared/obs'
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
  identifier: string
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

    this.entries.set(sourceId, { watcher, identifier: identifier ?? '', state })
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

  /** OBS links address a channel, not a session-scoped src-N, so nothing stops two
      entries answering to one key. First match wins — otherwise a dock double-prints
      every message the day a channel is added twice. */
  findByKey(platform: Platform, key: string): SourceState | null {
    for (const entry of this.entries.values()) {
      if (entry.state.platform !== platform) continue
      if (obsMatchKey(entry.identifier) !== key) continue

      return { ...entry.state }
    }

    return null
  }

  targetOf(sourceId: string): { platform: Platform; identifier: string } | null {
    const entry = this.entries.get(sourceId)
    if (!entry) return null

    return { platform: entry.state.platform, identifier: entry.identifier }
  }

  /** Brings a platform in line with the account signed into it: connect that channel, do
      nothing if it is already the one open, and swap if the account changed. Sources are
      no longer chosen by the user, so this is the only route by which one appears. */
  async ensureOnly(platform: Platform, identifier: string): Promise<void> {
    const wanted = normalizeIdentifier(platform, identifier)
    if (!wanted) return

    const existing = [...this.entries.values()].filter(
      (entry) => entry.state.platform === platform
    )

    if (existing.length === 1 && existing[0]?.identifier === wanted) return

    if (existing.length > 0) await this.removeByPlatform(platform)

    await this.add({ platform, label: '', identifier: wanted }).catch((error) => {
      console.warn(`[sources] could not open ${platform}/${wanted}:`, error)
    })
  }

  /** Which platforms can send at all, so the renderer draws a composer only where one
      could work. This is a capability of the code, not of the account — a signed-out
      Twitch still reports true and refuses with a reason when asked to send. */
  canSend(sourceId: string): boolean {
    return typeof this.entries.get(sourceId)?.watcher.send === 'function'
  }

  async send(sourceId: string, text: string): Promise<void> {
    const entry = this.entries.get(sourceId)
    if (!entry) throw new Error('no such chat')

    if (!entry.watcher.send) {
      throw new Error(`sending is not supported on ${entry.state.platform} yet`)
    }

    await entry.watcher.send(text)
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
