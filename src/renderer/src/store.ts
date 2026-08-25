import { create } from 'zustand'
import type {
  ChatBatch,
  ChatMessage,
  Rule,
  SourceState,
  TwitchAuthState
} from '@shared/types'

/** Per-pane scrollback. Chat is a live feed; old messages are not worth memory. */
const DEFAULT_CAPACITY = 500

/** Deleted ids linger after their message is evicted, so prune periodically. */
const DELETED_LIMIT = 4000

let ruleSeq = 0
function newRuleId(): string {
  return `rule-${Date.now().toString(36)}-${ruleSeq++}`
}

interface ChatState {
  sources: SourceState[]
  bySource: Record<string, ChatMessage[]>
  /** messageId -> true. Deleted messages are kept and struck through, the way
   *  Chatterino does, so moderation is visible rather than silently rewriting
   *  scrollback under the reader. */
  deleted: Record<string, true>

  rules: Rule[]
  showDeleted: boolean
  showTimestamps: boolean
  capacity: number
  /** Chat text size in px. Everything in a message row scales off this. */
  fontSize: number

  twitchAuth: TwitchAuthState

  setSources: (states: SourceState[]) => void
  setTwitchAuth: (state: TwitchAuthState) => void
  ingest: (batch: ChatBatch) => void
  clearSource: (sourceId: string) => void
  forgetSource: (sourceId: string) => void

  /** Relative step. Functional so rapid clicks can't read a stale value. */

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
  deleted: {},

  rules: [],
  showDeleted: true,
  showTimestamps: true,
  capacity: DEFAULT_CAPACITY,
  fontSize: 15,

  twitchAuth: { status: 'signed-out' },

  setSources: (states) => set({ sources: states }),
  setTwitchAuth: (twitchAuth) => set({ twitchAuth }),

  ingest: (batch) =>
    set((s) => {
      if (batch.messages.length === 0 && batch.moderation.length === 0) return s

      const capacity = s.capacity
      let bySource = s.bySource
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
              break
            }
          }
        }

        if (deletedChanged) deleted = nextDeleted
      }

      if (Object.keys(deleted).length > DELETED_LIMIT) {
        const live = new Set<string>()
        for (const list of Object.values(bySource)) {
          for (const m of list) live.add(m.id)
        }
        const pruned: Record<string, true> = {}
        for (const id of Object.keys(deleted)) {
          if (live.has(id)) pruned[id] = true
        }
        deleted = pruned
      }

      return { bySource, deleted }
    }),

  clearSource: (sourceId) =>
    set((s) => ({ bySource: { ...s.bySource, [sourceId]: [] } })),

  forgetSource: (sourceId) =>
    set((s) => {
      const bySource = { ...s.bySource }
      delete bySource[sourceId]
      return { bySource }
    }),


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
