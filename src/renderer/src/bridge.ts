import type {
  AddSourceRequest,
  ChatApi,
  ChatBatch,
  ChatMessage,
  ModerationEvent,
  Platform,
  SourceState
} from '@shared/types'
import { MOCK_PLATFORMS, makeMockMessage, pick } from '@shared/mockdata'

export type BridgeMode = 'electron' | 'browser'

/**
 * In Electron the preload injects window.api. Opened directly in a browser tab
 * there is no preload, so we stand up an in-page simulator with the same
 * contract and the same 100ms batching cadence. That makes the UI profileable
 * in browser devtools, which is far better tooling for a virtualized list under
 * load than Electron's inspector. Message *content* comes from the shared
 * generator, so only the transport differs from the real thing.
 */
export function getBridge(): { api: ChatApi; mode: BridgeMode } {
  if (window.api) return { api: window.api, mode: 'electron' }
  return { api: createBrowserBridge(), mode: 'browser' }
}

const FLUSH_INTERVAL_MS = 100
const RECENT_WINDOW = 40

interface SimSource {
  state: SourceState
  rate: number
  seq: number
  recent: ChatMessage[]
  accumulator: number
}

function createBrowserBridge(): ChatApi {
  const sources = new Map<string, SimSource>()
  const batchListeners = new Set<(b: ChatBatch) => void>()
  const sourceListeners = new Set<(s: SourceState[]) => void>()

  let pendingMessages: ChatMessage[] = []
  let pendingModeration: ModerationEvent[] = []
  let seq = 0
  let lastTick = performance.now()

  const listStates = (): SourceState[] => [...sources.values()].map((s) => ({ ...s.state }))
  const emitStates = (): void => {
    const states = listStates()
    sourceListeners.forEach((cb) => cb(states))
  }

  setInterval(() => {
    const now = performance.now()
    const elapsed = (now - lastTick) / 1000
    lastTick = now

    for (const sim of sources.values()) {
      if (sim.state.status !== 'connected') continue

      // Carry the fractional remainder so low rates stay accurate instead of
      // rounding to zero on every tick.
      sim.accumulator += sim.rate * elapsed
      const count = Math.floor(sim.accumulator)
      sim.accumulator -= count

      for (let i = 0; i < count; i++) {
        const msg = makeMockMessage({
          sourceId: sim.state.id,
          platform: sim.state.platform,
          seq: sim.seq++,
          recent: sim.recent
        })
        sim.recent.push(msg)
        if (sim.recent.length > RECENT_WINDOW) sim.recent.shift()
        pendingMessages.push(msg)
      }
    }

    if (pendingMessages.length === 0 && pendingModeration.length === 0) return

    const batch: ChatBatch = { messages: pendingMessages, moderation: pendingModeration }
    pendingMessages = []
    pendingModeration = []
    batchListeners.forEach((cb) => cb(batch))
  }, FLUSH_INTERVAL_MS)

  // Occasional moderation so the delete / timeout / clear paths are exercised.
  setInterval(() => {
    for (const sim of sources.values()) {
      if (sim.state.status !== 'connected' || sim.recent.length === 0) continue
      const roll = Math.random()
      const target = pick(sim.recent)
      if (roll < 0.6) {
        pendingModeration.push({
          type: 'delete-message',
          sourceId: sim.state.id,
          messageId: target.id
        })
      } else if (roll < 0.95) {
        pendingModeration.push({
          type: 'clear-user',
          sourceId: sim.state.id,
          userId: target.authorId
        })
      } else {
        pendingModeration.push({ type: 'clear-chat', sourceId: sim.state.id })
        sim.recent = []
      }
    }
  }, 7000)

  return {
    async listSources() {
      return listStates()
    },

    async addSource(req: AddSourceRequest) {
      const id = `src-${++seq}`
      const platform: Platform = req.platform === 'mock' ? pick(MOCK_PLATFORMS) : req.platform
      const sim: SimSource = {
        state: {
          id,
          platform,
          label: req.label || `mock/${platform}`,
          status: 'connecting',
          live: false
        },
        rate: req.rate ?? 5,
        seq: 0,
        recent: [],
        accumulator: 0
      }
      sources.set(id, sim)
      emitStates()

      setTimeout(() => {
        if (!sources.has(id)) return
        sim.state.status = 'connected'
        sim.state.live = true
        emitStates()
      }, 200)

      return id
    },

    async removeSource(sourceId: string) {
      sources.delete(sourceId)
      pendingMessages = pendingMessages.filter((m) => m.sourceId !== sourceId)
      pendingModeration = pendingModeration.filter((m) => m.sourceId !== sourceId)
      emitStates()
    },

    async setRate(sourceId: string, rate: number) {
      const sim = sources.get(sourceId)
      if (sim) sim.rate = Math.max(0, rate)
    },

    async openExternal(url: string) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },

    onBatch(cb) {
      batchListeners.add(cb)
      return () => batchListeners.delete(cb)
    },

    onSources(cb) {
      sourceListeners.add(cb)
      return () => sourceListeners.delete(cb)
    }
  }
}

let cached: { api: ChatApi; mode: BridgeMode } | null = null

/** Process-wide singleton; the preload has already run by the time this is hit. */
export function bridge(): { api: ChatApi; mode: BridgeMode } {
  return (cached ??= getBridge())
}
