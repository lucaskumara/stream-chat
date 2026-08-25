import { create } from 'zustand'
import type {
  ChatBatch,
  ChatMessage,
  SourceState,
  TwitchAuthState
} from '@shared/types'

const DEFAULT_CAPACITY = 500

const DELETED_LIMIT = 4000

interface ChatState {
  sources: SourceState[]
  bySource: Record<string, ChatMessage[]>

  deleted: Record<string, true>

  showDeleted: boolean
  showTimestamps: boolean
  capacity: number

  fontSize: number

  twitchAuth: TwitchAuthState

  setSources: (states: SourceState[]) => void
  setTwitchAuth: (state: TwitchAuthState) => void
  ingest: (batch: ChatBatch) => void
  clearSource: (sourceId: string) => void
  forgetSource: (sourceId: string) => void
}

function capped(arr: ChatMessage[], capacity: number): ChatMessage[] {
  return arr.length > capacity ? arr.slice(arr.length - capacity) : arr
}

export const useStore = create<ChatState>()((set) => ({
  sources: [],
  bySource: {},
  deleted: {},

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
}))
