import { create } from 'zustand'
import { PLATFORMS } from '@shared/types'
import type {
  ChatBatch,
  ChatMessage,
  ModerationEvent,
  Platform,
  PlatformConfig,
  SourceState
} from '@shared/types'

const DEFAULT_CAPACITY = 500

const DELETED_LIMIT = 4000

/** The handoff lists steps 12/14/16/18/20/24 with a default of 15, which is not one of
    them — in the mock either stepper button therefore jumps straight to 12. 15 is added
    as a step so the stepper moves one notch at a time from the default. */
export const CHAT_FONT_SIZES = [12, 14, 15, 16, 18, 20, 24]
export const CHAT_FONT_DEFAULT = 15

export type View = 'chats' | 'broadcast' | 'settings'

export type SettingsPane = 'general' | 'appearance' | 'chat' | 'platforms'

export type Density = 'comfortable' | 'compact'
export type ThemeChoice = 'dark' | 'system' | 'light'

interface ChatState {
  sources: SourceState[]
  bySource: Messages

  view: View
  settingsPane: SettingsPane

  /** One chat per platform, so the tab strip is the platform list and a pane is
      whichever source carries a visible platform. Panes run in PLATFORMS order,
      which is the order the tabs are drawn in. */
  visiblePlatforms: Platform[]

  /** Whether the visible chats share one column. Connected chats merge; a visible
      platform with no channel keeps its own column either way, or its connect form
      would have nowhere to go. */
  merged: boolean

  filterOpen: Record<string, boolean>

  /** Only one pane's settings popover is open at a time, so this is a single id
      rather than a record: opening one closes any other. */
  gearOpenFor: string | null

  deleted: Deleted

  search: Record<string, string[]>
  searchDraft: Record<string, string>

  showDeleted: boolean
  showTimestamps: boolean
  capacity: number

  density: Density
  themeChoice: ThemeChoice
  colorByPlatform: boolean
  defaultFontSize: number

  /** What the OS asks for, kept here so resolvedTheme can answer 'system' from the
      store rather than from a media query every component would have to repeat. */
  systemDark: boolean

  reopenChannels: boolean

  /** Chat row size per source, in px from CHAT_FONT_SIZES. Missing means the default. */
  fontSize: Record<string, number>

  platforms: PlatformConfig[]

  setSources: (states: SourceState[]) => void
  setPlatforms: (platforms: PlatformConfig[]) => void
  togglePlatform: (platform: Platform) => void
  toggleMerged: () => void
  ingest: (batch: ChatBatch) => void
  setView: (view: View) => void
  setSettingsPane: (pane: SettingsPane) => void
  toggleFilter: (sourceId: string) => void
  toggleGear: (sourceId: string) => void
  closeGear: () => void
  setShowDeleted: (showDeleted: boolean) => void
  setShowTimestamps: (showTimestamps: boolean) => void
  setCapacity: (capacity: number) => void
  setDensity: (density: Density) => void
  setThemeChoice: (theme: ThemeChoice) => void
  setSystemDark: (systemDark: boolean) => void
  setColorByPlatform: (on: boolean) => void
  stepDefaultFontSize: (steps: number) => void
  setReopenChannels: (on: boolean) => void
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

function steppedSize(current: number, steps: number): number {
  const at = CHAT_FONT_SIZES.indexOf(current)
  const from = at === -1 ? CHAT_FONT_SIZES.indexOf(CHAT_FONT_DEFAULT) : at
  const last = CHAT_FONT_SIZES.length - 1

  return CHAT_FONT_SIZES[Math.min(last, Math.max(0, from + steps))]
}

function capped(arr: ChatMessage[], capacity: number): ChatMessage[] {
  return arr.length > capacity ? arr.slice(arr.length - capacity) : arr
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
  deleted: {},
  search: {},
  searchDraft: {},

  visiblePlatforms: ['twitch'],
  merged: false,

  view: 'chats',
  settingsPane: 'general',
  filterOpen: {},
  gearOpenFor: null,

  showDeleted: true,
  showTimestamps: true,
  capacity: DEFAULT_CAPACITY,
  fontSize: {},

  density: 'comfortable',
  themeChoice: 'dark',
  colorByPlatform: true,
  defaultFontSize: CHAT_FONT_DEFAULT,

  systemDark: true,

  reopenChannels: true,

  platforms: [],

  /** A cold start adopts whatever main already has — the backlog replay after a
      renderer crash otherwise leaves the connect form up over a live chat. Later
      updates never move the tabs: a status event on one platform must not pull the
      user off the form they are typing into on another. */
  setSources: (states) =>
    set((s) => {
      if (s.sources.length > 0) return { sources: states }
      if (states.length === 0) return { sources: states }

      const live = new Set(states.map((state) => state.platform))

      return { sources: states, visiblePlatforms: PLATFORMS.filter((held) => live.has(held)) }
    }),

  setPlatforms: (platforms) => set({ platforms }),

  /** Panes run in tab order rather than the order they were switched on, so a split
      reads left to right the same as the strip above it. The last pane cannot be
      switched off — the view must never empty. */
  togglePlatform: (platform) =>
    set((s) => {
      const held = s.visiblePlatforms.includes(platform)
      if (held && s.visiblePlatforms.length === 1) return { view: 'chats' }

      const next = new Set(s.visiblePlatforms)
      if (held) next.delete(platform)
      else next.add(platform)

      return { visiblePlatforms: PLATFORMS.filter((each) => next.has(each)), view: 'chats' }
    }),

  toggleMerged: () => set((s) => ({ merged: !s.merged })),

  ingest: (batch) =>
    set((s) => {
      if (batch.messages.length === 0 && batch.moderation.length === 0) return s

      const appendedTo = appended(s.bySource, batch.messages, s.capacity)
      const { messages, deleted } = moderated(appendedTo, s.deleted, batch.moderation)

      return { bySource: messages, deleted: sweptDeleted(deleted, messages) }
    }),

  setView: (view) => set({ view }),

  setSettingsPane: (settingsPane) => set({ settingsPane }),

  toggleFilter: (sourceId) =>
    set((s) => ({
      filterOpen: { ...s.filterOpen, [sourceId]: !s.filterOpen[sourceId] }
    })),

  toggleGear: (sourceId) =>
    set((s) => ({ gearOpenFor: s.gearOpenFor === sourceId ? null : sourceId })),

  closeGear: () => set({ gearOpenFor: null }),

  setShowDeleted: (showDeleted) => set({ showDeleted }),

  setShowTimestamps: (showTimestamps) => set({ showTimestamps }),

  setCapacity: (capacity) =>
    set((s) => ({
      capacity,
      bySource: Object.fromEntries(
        Object.entries(s.bySource).map(([sourceId, held]) => [sourceId, capped(held, capacity)])
      )
    })),

  setDensity: (density) => set({ density }),

  setThemeChoice: (themeChoice) => set({ themeChoice }),

  setSystemDark: (systemDark) => set({ systemDark }),

  setColorByPlatform: (colorByPlatform) => set({ colorByPlatform }),

  stepDefaultFontSize: (steps) =>
    set((s) => ({ defaultFontSize: steppedSize(s.defaultFontSize, steps) })),

  setReopenChannels: (reopenChannels) => set({ reopenChannels }),

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
      const current = s.fontSize[sourceId] ?? s.defaultFontSize
      const next = steppedSize(current, steps)
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
      filterOpen: omit(s.filterOpen, sourceId),
      gearOpenFor: s.gearOpenFor === sourceId ? null : s.gearOpenFor
    }))
}))
