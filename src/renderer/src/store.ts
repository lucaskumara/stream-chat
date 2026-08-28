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

  visibleIds: string[]
  groups: string[][]

  deleted: Record<string, true>

  search: Record<string, string[]>
  searchDraft: Record<string, string>

  showDeleted: boolean
  showTimestamps: boolean
  capacity: number

  /** Chat row size in rem, against the 16px root pinned in index.css. */
  fontSize: number

  twitchAuth: TwitchAuthState

  setSources: (states: SourceState[]) => void
  setTwitchAuth: (state: TwitchAuthState) => void
  reorderSources: (orderedIds: string[]) => void
  showSource: (sourceId: string) => void
  toggleSplit: (sourceId: string) => void
  ingest: (batch: ChatBatch) => void
  setSearch: (sourceId: string, terms: string[]) => void
  setSearchDraft: (sourceId: string, draft: string) => void
  clearSource: (sourceId: string) => void
  forgetSource: (sourceId: string) => void
}

function capped(arr: ChatMessage[], capacity: number): ChatMessage[] {
  return arr.length > capacity ? arr.slice(arr.length - capacity) : arr
}

function pruneGroups(groups: string[][], keep: (sourceId: string) => boolean): string[][] {
  return groups.map((group) => group.filter(keep)).filter((group) => group.length > 1)
}

export const useStore = create<ChatState>()((set) => ({
  sources: [],
  bySource: {},
  visibleIds: [],
  groups: [],
  deleted: {},
  search: {},
  searchDraft: {},

  showDeleted: true,
  showTimestamps: true,
  capacity: DEFAULT_CAPACITY,
  fontSize: 1,

  twitchAuth: { status: 'signed-out' },

  setSources: (states) =>
    set((s) => {
      const alive = new Set(states.map((state) => state.id))
      const kept = s.visibleIds.filter((id) => alive.has(id))

      const opened =
        s.sources.length > 0
          ? states.find((state) => !s.sources.some((was) => was.id === state.id))
          : undefined

      const groups = pruneGroups(s.groups, (id) => alive.has(id))

      if (opened) return { sources: states, groups, visibleIds: [opened.id] }
      if (kept.length > 0) return { sources: states, groups, visibleIds: kept }

      return {
        sources: states,
        groups,
        visibleIds: states.slice(0, 1).map((state) => state.id)
      }
    }),

  setTwitchAuth: (twitchAuth) => set({ twitchAuth }),

  reorderSources: (orderedIds) =>
    set((s) => {
      const byId = new Map(s.sources.map((source) => [source.id, source]))

      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((source): source is SourceState => source !== undefined)

      return ordered.length === s.sources.length ? { sources: ordered } : s
    }),

  showSource: (sourceId) =>
    set((s) => {
      if (s.visibleIds.includes(sourceId)) return s

      const group = s.groups.find((ids) => ids.includes(sourceId))

      return { visibleIds: group ? [...group] : [sourceId] }
    }),

  toggleSplit: (sourceId) =>
    set((s) => {
      const held = s.visibleIds.includes(sourceId)
      if (held && s.visibleIds.length === 1) return s

      const visibleIds = held
        ? s.visibleIds.filter((id) => id !== sourceId)
        : [...s.visibleIds, sourceId]

      const touched = new Set([...visibleIds, sourceId])
      const groups = pruneGroups(s.groups, (id) => !touched.has(id))

      return {
        visibleIds,
        groups: visibleIds.length > 1 ? [...groups, visibleIds] : groups
      }
    }),

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

  setSearch: (sourceId, terms) =>
    set((s) => ({ search: { ...s.search, [sourceId]: terms } })),

  setSearchDraft: (sourceId, draft) =>
    set((s) => {
      if (s.searchDraft[sourceId] === draft) return s

      return { searchDraft: { ...s.searchDraft, [sourceId]: draft } }
    }),

  clearSource: (sourceId) =>
    set((s) => {
      if (!s.bySource[sourceId]?.length) return s

      return { bySource: { ...s.bySource, [sourceId]: [] } }
    }),

  forgetSource: (sourceId) =>
    set((s) => {
      const bySource = { ...s.bySource }
      delete bySource[sourceId]

      const search = { ...s.search }
      delete search[sourceId]

      const searchDraft = { ...s.searchDraft }
      delete searchDraft[sourceId]

      return {
        bySource,
        search,
        searchDraft,
        visibleIds: s.visibleIds.filter((id) => id !== sourceId),
        groups: pruneGroups(s.groups, (id) => id !== sourceId)
      }
    }),
}))
