import { create } from 'zustand'
import type { ChatBatch, ChatMessage, Rule, SourceState, ViewMode } from '@shared/types'

/** Per-pane scrollback. Chat is a live feed; old messages are not worth memory. */
const DEFAULT_CAPACITY = 500

/** Deleted ids linger after their message is evicted, so prune periodically. */
const DELETED_LIMIT = 4000

const clampFont = (px: number): number => Math.max(10, Math.min(Math.round(px), 28))

let ruleSeq = 0
export function newRuleId(): string {
  return `rule-${Date.now().toString(36)}-${ruleSeq++}`
}

interface ChatState {
  sources: SourceState[]
  bySource: Record<string, ChatMessage[]>
  combined: ChatMessage[]
  /** messageId -> true. Deleted messages are kept and struck through, the way
   *  Chatterino does, so moderation is visible rather than silently rewriting
   *  scrollback under the reader. */
  deleted: Record<string, true>

  view: ViewMode
  rules: Rule[]
  search: string
  showDeleted: boolean
  showTimestamps: boolean
  capacity: number
  /** Chat text size in px. Everything in a message row scales off this. */
  fontSize: number

  /** Monotonic count of everything received, for the throughput readout. */
  received: number

  setSources: (states: SourceState[]) => void
  ingest: (batch: ChatBatch) => void
  clearSource: (sourceId: string) => void
  forgetSource: (sourceId: string) => void

  setView: (view: ViewMode) => void
  setSearch: (search: string) => void
  setCapacity: (capacity: number) => void
  toggleShowDeleted: () => void
  setFontSize: (px: number) => void
  /** Relative step. Functional so rapid clicks can't read a stale value. */
  stepFontSize: (delta: number) => void
  toggleTimestamps: () => void

  addRule: (rule?: Partial<Rule>) => void
  updateRule: (id: string, patch: Partial<Rule>) => void
  removeRule: (id: string) => void
}

function capped(arr: ChatMessage[], capacity: number): ChatMessage[] {
  return arr.length > capacity ? arr.slice(arr.length - capacity) : arr
}

export const useStore = create<ChatState>()((set) => ({
  sources: [],
  bySource: {},
  combined: [],
  deleted: {},

  view: 'panes',
  rules: [],
  search: '',
  showDeleted: true,
  showTimestamps: true,
  capacity: DEFAULT_CAPACITY,
  fontSize: 15,

  received: 0,

  setSources: (states) => set({ sources: states }),

  ingest: (batch) =>
    set((s) => {
      if (batch.messages.length === 0 && batch.moderation.length === 0) return s

      const capacity = s.capacity
      let bySource = s.bySource
      let combined = s.combined
      let deleted = s.deleted

      if (batch.messages.length > 0) {
        // Group first so each source's array is copied once per batch rather
        // than once per message.
        const grouped = new Map<string, ChatMessage[]>()
        for (const msg of batch.messages) {
          const list = grouped.get(msg.sourceId)
          if (list) list.push(msg)
          else grouped.set(msg.sourceId, [msg])
        }

        bySource = { ...bySource }
        for (const [sourceId, msgs] of grouped) {
          bySource[sourceId] = capped((bySource[sourceId] ?? []).concat(msgs), capacity)
        }

        // The combined view holds the same object references, so this costs
        // one extra pointer per message, not a second copy of the payload.
        combined = capped(combined.concat(batch.messages), capacity * 2)
      }

      if (batch.moderation.length > 0) {
        let deletedChanged = false
        const nextDeleted: Record<string, true> = { ...deleted }

        for (const evt of batch.moderation) {
          switch (evt.type) {
            case 'delete-message': {
              nextDeleted[evt.messageId] = true
              deletedChanged = true
              break
            }
            case 'clear-user': {
              // A timeout retroactively removes that user's scrollback. Only
              // messages already received are affected; the platform simply
              // stops sending new ones.
              for (const msg of bySource[evt.sourceId] ?? []) {
                if (msg.authorId === evt.userId) {
                  nextDeleted[msg.id] = true
                  deletedChanged = true
                }
              }
              break
            }
            case 'clear-chat': {
              if (bySource === s.bySource) bySource = { ...bySource }
              bySource[evt.sourceId] = []
              combined = combined.filter((m) => m.sourceId !== evt.sourceId)
              break
            }
          }
        }

        if (deletedChanged) deleted = nextDeleted
      }

      if (Object.keys(deleted).length > DELETED_LIMIT) {
        const live = new Set(combined.map((m) => m.id))
        for (const list of Object.values(bySource)) {
          for (const m of list) live.add(m.id)
        }
        const pruned: Record<string, true> = {}
        for (const id of Object.keys(deleted)) {
          if (live.has(id)) pruned[id] = true
        }
        deleted = pruned
      }

      return {
        bySource,
        combined,
        deleted,
        received: s.received + batch.messages.length
      }
    }),

  clearSource: (sourceId) =>
    set((s) => ({
      bySource: { ...s.bySource, [sourceId]: [] },
      combined: s.combined.filter((m) => m.sourceId !== sourceId)
    })),

  forgetSource: (sourceId) =>
    set((s) => {
      const bySource = { ...s.bySource }
      delete bySource[sourceId]
      return {
        bySource,
        combined: s.combined.filter((m) => m.sourceId !== sourceId)
      }
    }),

  setView: (view) => set({ view }),
  setSearch: (search) => set({ search }),
  setCapacity: (capacity) =>
    set((s) => {
      const next = Math.max(50, Math.min(capacity, 5000))
      const bySource: Record<string, ChatMessage[]> = {}
      for (const [id, list] of Object.entries(s.bySource)) {
        bySource[id] = capped(list, next)
      }
      return { capacity: next, bySource, combined: capped(s.combined, next * 2) }
    }),
  toggleShowDeleted: () => set((s) => ({ showDeleted: !s.showDeleted })),
  setFontSize: (px) => set({ fontSize: clampFont(px) }),
  stepFontSize: (delta) => set((s) => ({ fontSize: clampFont(s.fontSize + delta) })),
  toggleTimestamps: () => set((s) => ({ showTimestamps: !s.showTimestamps })),

  addRule: (rule) =>
    set((s) => ({
      rules: [
        ...s.rules,
        {
          id: newRuleId(),
          enabled: true,
          action: 'highlight',
          field: 'any',
          pattern: '',
          isRegex: false,
          caseSensitive: false,
          color: '#6366f1',
          ...rule
        }
      ]
    })),

  updateRule: (id, patch) =>
    set((s) => ({
      rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r))
    })),

  removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }))
}))
