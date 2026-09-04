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

/** Even steps of 2 from the floor to the ceiling, so every stepper click moves the same
    amount — the 15 that used to sit between 14 and 16 broke that for the one notch on
    either side of the default. */
export const CHAT_FONT_SIZES = [12, 14, 16, 18, 20, 22, 24]
export const CHAT_FONT_DEFAULT = 16

export type View = 'chats' | 'broadcast'

export type SettingsPane = 'general' | 'appearance' | 'platforms'

export type Density = 'comfortable' | 'compact'
export type ThemeChoice = 'dark' | 'system' | 'light'

/** 'author' is a message's own colour, or the per-author hash fallback — the
    original, only behaviour before this existed. 'platform' paints every name with
    its message's platform colour, which only reads as distinct from 'author' where
    more than one platform's messages actually share a column. 'none' drops colour
    entirely, in favour of the same heading tone the rest of the chrome uses for
    emphasis. */
export type NameColorMode = 'author' | 'platform' | 'none'

interface ChatState {
  sources: SourceState[]
  bySource: Messages

  view: View

  /** Settings renders as a modal over whichever view is underneath, not a third
      view of its own — so it is a flag, not a member of `View`. */
  settingsOpen: boolean
  settingsPane: SettingsPane

  /** Set alongside opening Settings from a platform-specific prompt (a
      NotConfigured column, Broadcast's "Add a stream key"), so the Platforms
      pane can jump straight to that card instead of landing on top showing
      whichever platform is first. Cleared once the scroll has happened. */
  platformsScrollTarget: Platform | null

  /** One chat per platform, so the tab strip is the platform list and a pane is
      whichever source carries a visible platform. Panes run in PLATFORMS order,
      which is the order the tabs are drawn in. */
  visiblePlatforms: Platform[]

  /** Whether the visible chats share one column. Connected chats merge; a visible
      platform with no channel keeps its own column either way, or its connect form
      would have nowhere to go. */
  merged: boolean

  filterOpen: Record<string, boolean>

  deleted: Deleted

  search: Record<string, string[]>
  searchDraft: Record<string, string>

  showDeleted: boolean
  showTimestamps: boolean
  capacity: number

  density: Density
  themeChoice: ThemeChoice

  /** Which panes are split — one platform per column — and which are the one
      merged column varies by layout, so the name colouring choice is held once for
      each rather than as a single flag. */
  nameColorSplit: NameColorMode
  nameColorMerged: NameColorMode

  /** Every chat renders at this size, in px from CHAT_FONT_SIZES — one setting for
      the whole app, not per source. */
  fontSize: number

  /** What the OS asks for, kept here so resolvedTheme can answer 'system' from the
      store rather than from a media query every component would have to repeat. */
  systemDark: boolean

  platforms: PlatformConfig[]

  setSources: (states: SourceState[]) => void
  setPlatforms: (platforms: PlatformConfig[]) => void
  togglePlatform: (platform: Platform) => void
  toggleMerged: () => void
  ingest: (batch: ChatBatch) => void
  setView: (view: View) => void
  openSettings: () => void
  closeSettings: () => void
  setSettingsPane: (pane: SettingsPane) => void
  openSettingsForPlatform: (platform: Platform) => void
  clearPlatformsScrollTarget: () => void
  toggleFilter: (sourceId: string) => void
  setShowDeleted: (showDeleted: boolean) => void
  setShowTimestamps: (showTimestamps: boolean) => void
  setCapacity: (capacity: number) => void
  setDensity: (density: Density) => void
  setThemeChoice: (theme: ThemeChoice) => void
  setSystemDark: (systemDark: boolean) => void
  setNameColorSplit: (mode: NameColorMode) => void
  setNameColorMerged: (mode: NameColorMode) => void
  stepFontSize: (steps: number) => void
  resetFontSize: () => void
  setSearch: (sourceId: string, terms: string[]) => void
  setSearchDraft: (sourceId: string, draft: string) => void
  addSearchTerm: (sourceId: string, term: string) => void
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
  settingsOpen: false,
  settingsPane: 'general',
  platformsScrollTarget: null,
  filterOpen: {},

  showDeleted: true,
  showTimestamps: true,
  capacity: DEFAULT_CAPACITY,

  density: 'comfortable',
  themeChoice: 'system',
  nameColorSplit: 'author',
  nameColorMerged: 'author',
  fontSize: CHAT_FONT_DEFAULT,

  systemDark: true,

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
      if (held && s.visiblePlatforms.length === 1) return { view: 'chats', settingsOpen: false }

      const next = new Set(s.visiblePlatforms)
      if (held) next.delete(platform)
      else next.add(platform)

      return {
        visiblePlatforms: PLATFORMS.filter((each) => next.has(each)),
        view: 'chats',
        settingsOpen: false
      }
    }),

  toggleMerged: () => set((s) => ({ merged: !s.merged })),

  ingest: (batch) =>
    set((s) => {
      if (batch.messages.length === 0 && batch.moderation.length === 0) return s

      const appendedTo = appended(s.bySource, batch.messages, s.capacity)
      const { messages, deleted } = moderated(appendedTo, s.deleted, batch.moderation)

      return { bySource: messages, deleted: sweptDeleted(deleted, messages) }
    }),

  setView: (view) => set({ view, settingsOpen: false }),

  openSettings: () => set({ settingsOpen: true }),

  closeSettings: () => set({ settingsOpen: false }),

  setSettingsPane: (settingsPane) => set({ settingsPane }),

  openSettingsForPlatform: (platform) =>
    set({ settingsOpen: true, settingsPane: 'platforms', platformsScrollTarget: platform }),

  clearPlatformsScrollTarget: () => set({ platformsScrollTarget: null }),

  toggleFilter: (sourceId) =>
    set((s) => ({
      filterOpen: { ...s.filterOpen, [sourceId]: !s.filterOpen[sourceId] }
    })),

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

  setNameColorSplit: (nameColorSplit) => set({ nameColorSplit }),

  setNameColorMerged: (nameColorMerged) => set({ nameColorMerged }),

  stepFontSize: (steps) => set((s) => ({ fontSize: steppedSize(s.fontSize, steps) })),

  resetFontSize: () => set({ fontSize: CHAT_FONT_DEFAULT }),

  setSearch: (sourceId, terms) =>
    set((s) => ({ search: { ...s.search, [sourceId]: terms } })),

  setSearchDraft: (sourceId, draft) =>
    set((s) => {
      if (s.searchDraft[sourceId] === draft) return s

      return { searchDraft: { ...s.searchDraft, [sourceId]: draft } }
    }),

  // Clicking a name in chat is the only caller — it always means "filter by this
  // person", so the panel holding the now-nonzero term count has to open too, or
  // the click reads as if nothing happened. Opens it even on a repeat click of an
  // already-filtered name, since the panel could still be closed from before.
  addSearchTerm: (sourceId, term) =>
    set((s) => {
      const existing = s.search[sourceId] ?? []
      const already = existing.some((held) => held.toLowerCase() === term.toLowerCase())

      return {
        search: already ? s.search : { ...s.search, [sourceId]: [...existing, term] },
        filterOpen: { ...s.filterOpen, [sourceId]: true }
      }
    })
}))
