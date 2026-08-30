import { create } from 'zustand'
import type {
  ChatBatch,
  ChatMessage,
  ModerationEvent,
  SourceState,
  TwitchAuthState
} from '@shared/types'

const DEFAULT_CAPACITY = 500

const DELETED_LIMIT = 4000

/** Chat rows have their own range, wider than the chrome's type scale: 10px to 24px
    in 2px steps. The chrome stays on the four --text-* variables in index.css. */
export const CHAT_FONT_SIZES = [10, 12, 14, 16, 18, 20, 22, 24]
export const CHAT_FONT_DEFAULT = 16

interface ChatState {
  sources: SourceState[]
  bySource: Messages

  visibleIds: string[]
  groups: string[][]

  deleted: Deleted

  search: Record<string, string[]>
  searchDraft: Record<string, string>

  showDeleted: boolean
  showTimestamps: boolean
  capacity: number

  /** Chat row size per source, in px from CHAT_FONT_SIZES. Missing means the default. */
  fontSize: Record<string, number>

  twitchAuth: TwitchAuthState

  setSources: (states: SourceState[]) => void
  setTwitchAuth: (state: TwitchAuthState) => void
  reorderSources: (orderedIds: string[]) => void
  showSource: (sourceId: string) => void
  toggleSplit: (sourceId: string) => void
  ingest: (batch: ChatBatch) => void
  setShowDeleted: (showDeleted: boolean) => void
  setShowTimestamps: (showTimestamps: boolean) => void
  setSearch: (sourceId: string, terms: string[]) => void
  setSearchDraft: (sourceId: string, draft: string) => void
  addSearchTerm: (sourceId: string, term: string) => void
  stepFontSize: (sourceId: string, steps: number) => void
  resetFontSize: (sourceId: string) => void
  clearSource: (sourceId: string) => void
  forgetSource: (sourceId: string) => void
}

type Messages = Record<string, ChatMessage[]>
type Deleted = Record<string, true>

function capped(arr: ChatMessage[], capacity: number): ChatMessage[] {
  return arr.length > capacity ? arr.slice(arr.length - capacity) : arr
}

function pruneGroups(groups: string[][], keep: (sourceId: string) => boolean): string[][] {
  return groups.map((group) => group.filter(keep)).filter((group) => group.length > 1)
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]

  return next
}

function appended(held: Messages, incoming: ChatMessage[], capacity: number): Messages {
  if (incoming.length === 0) return held

  const grouped = new Map<string, ChatMessage[]>()
  for (const msg of incoming) {
    const list = grouped.get(msg.sourceId)
    if (list) list.push(msg)
    else grouped.set(msg.sourceId, [msg])
  }

  const next = { ...held }
  for (const [sourceId, msgs] of grouped) {
    next[sourceId] = capped((next[sourceId] ?? []).concat(msgs), capacity)
  }

  return next
}

function moderated(
  held: Messages,
  deleted: Deleted,
  events: ModerationEvent[]
): { messages: Messages; deleted: Deleted } {
  if (events.length === 0) return { messages: held, deleted }

  let messages = held
  const struck: Deleted = { ...deleted }
  let struckAny = false

  for (const event of events) {
    switch (event.type) {
      case 'delete-message':
        struck[event.messageId] = true
        struckAny = true
        break

      case 'clear-user':
        for (const msg of messages[event.sourceId] ?? []) {
          if (msg.authorId !== event.userId) continue

          struck[msg.id] = true
          struckAny = true
        }
        break

      case 'clear-chat':
        messages = { ...messages, [event.sourceId]: [] }
        break
    }
  }

  return { messages, deleted: struckAny ? struck : deleted }
}

/** Ids of messages already evicted from every ring buffer can never be looked up
    again, so the strike set is swept back down to what is still on screen. */
function sweptDeleted(deleted: Deleted, messages: Messages): Deleted {
  if (Object.keys(deleted).length <= DELETED_LIMIT) return deleted

  const live = new Set<string>()
  for (const list of Object.values(messages)) {
    for (const msg of list) live.add(msg.id)
  }

  const kept: Deleted = {}
  for (const id of Object.keys(deleted)) {
    if (live.has(id)) kept[id] = true
  }

  return kept
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
  fontSize: {},

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

      const appendedTo = appended(s.bySource, batch.messages, s.capacity)
      const { messages, deleted } = moderated(appendedTo, s.deleted, batch.moderation)

      return { bySource: messages, deleted: sweptDeleted(deleted, messages) }
    }),

  setShowDeleted: (showDeleted) => set({ showDeleted }),

  setShowTimestamps: (showTimestamps) => set({ showTimestamps }),

  setSearch: (sourceId, terms) =>
    set((s) => ({ search: { ...s.search, [sourceId]: terms } })),

  setSearchDraft: (sourceId, draft) =>
    set((s) => {
      if (s.searchDraft[sourceId] === draft) return s

      return { searchDraft: { ...s.searchDraft, [sourceId]: draft } }
    }),

  addSearchTerm: (sourceId, term) =>
    set((s) => {
      const existing = s.search[sourceId] ?? []
      if (existing.some((held) => held.toLowerCase() === term.toLowerCase())) return s

      return { search: { ...s.search, [sourceId]: [...existing, term] } }
    }),

  stepFontSize: (sourceId, steps) =>
    set((s) => {
      const current = s.fontSize[sourceId] ?? CHAT_FONT_DEFAULT
      const at = CHAT_FONT_SIZES.indexOf(current)
      const from = at === -1 ? CHAT_FONT_SIZES.indexOf(CHAT_FONT_DEFAULT) : at

      const next = CHAT_FONT_SIZES[Math.min(CHAT_FONT_SIZES.length - 1, Math.max(0, from + steps))]
      if (next === current) return s

      return { fontSize: { ...s.fontSize, [sourceId]: next } }
    }),

  resetFontSize: (sourceId) =>
    set((s) => {
      if (s.fontSize[sourceId] === undefined) return s

      return { fontSize: omit(s.fontSize, sourceId) }
    }),

  clearSource: (sourceId) =>
    set((s) => {
      if (!s.bySource[sourceId]?.length) return s

      return { bySource: { ...s.bySource, [sourceId]: [] } }
    }),

  forgetSource: (sourceId) =>
    set((s) => ({
      bySource: omit(s.bySource, sourceId),
      search: omit(s.search, sourceId),
      searchDraft: omit(s.searchDraft, sourceId),
      fontSize: omit(s.fontSize, sourceId),
      visibleIds: s.visibleIds.filter((id) => id !== sourceId),
      groups: pruneGroups(s.groups, (id) => id !== sourceId)
    })),
}))
