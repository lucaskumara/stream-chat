import { useCallback, useEffect, useMemo } from 'react'
import type { ChatMessage } from '@shared/types'
import { bridge } from './bridge'
import { chatColumns, columnLabel, columnPaneId, type ChatColumn } from './layout'
import { resolvedTheme, type ThemeMode } from './theme'
import { mergeMessages } from './merge'
import { useStore } from './store'
import { ChatPane } from './components/ChatPane'
import { NotConfigured } from './components/NotConfigured'
import { TitleBar } from './components/TitleBar'
import { SettingsModal } from './components/SettingsModal'
import { Broadcast } from './views/Broadcast'

const EMPTY_TERMS: string[] = []
const EMPTY_MESSAGES: ChatMessage[] = []

/** The store's actions never change identity, so reading them off the module rather than
    through a hook keeps every callback below stable across renders — which is what lets
    `ChatPaneBar`'s memo actually hold. */
const actions = useStore.getState()

/** `useStore()` with no selector subscribes to the whole store, so this component
    re-rendered on every 100ms chat batch, on a keystroke in another pane's filter, and
    on any settings change — rebuilding fourteen closures each time and defeating the
    memo on everything below it. Each field is selected on its own instead. */
function Pane({
  column,
  messages,
  mode
}: {
  column: ChatColumn
  messages: ChatMessage[]
  mode: ThemeMode
}): React.ReactElement {
  const paneId = columnPaneId(column)
  const { sources } = column

  const deleted = useStore((s) => s.deleted)
  const showDeleted = useStore((s) => s.showDeleted)
  const showTimestamps = useStore((s) => s.showTimestamps)
  const density = useStore((s) => s.density)
  const filterOpen = useStore((s) => s.filterOpen[paneId] === true)
  const searchTerms = useStore((s) => s.search[paneId]) ?? EMPTY_TERMS
  const searchDraft = useStore((s) => s.searchDraft[paneId]) ?? ''
  const fontSize = useStore((s) => s.fontSize)

  const onToggleFilter = useCallback(() => actions.toggleFilter(paneId), [paneId])
  const onSearchTerms = useCallback(
    (terms: string[]) => actions.setSearch(paneId, terms),
    [paneId]
  )
  const onSearchDraft = useCallback(
    (draft: string) => actions.setSearchDraft(paneId, draft),
    [paneId]
  )
  const onAddSearchTerm = useCallback(
    (term: string) => actions.addSearchTerm(paneId, term),
    [paneId]
  )

  return (
    <ChatPane
      sources={sources}
      label={columnLabel(column)}
      showPlatform={sources.length > 1}
      messages={messages}
      deleted={deleted}
      showDeleted={showDeleted}
      showTimestamps={showTimestamps}
      density={density}
      mode={mode}
      filterOpen={filterOpen}
      onToggleFilter={onToggleFilter}
      searchTerms={searchTerms}
      searchDraft={searchDraft}
      onSearchTerms={onSearchTerms}
      onSearchDraft={onSearchDraft}
      onAddSearchTerm={onAddSearchTerm}
      fontSize={fontSize}
    />
  )
}

function Column({ column, mode }: { column: ChatColumn; mode: ThemeMode }): React.ReactElement {
  const bySource = useStore((s) => s.bySource)

  const messages = useMemo(
    () => mergeMessages(column.sources.map((source) => bySource[source.id] ?? EMPTY_MESSAGES)),
    [column, bySource]
  )

  if (column.platform !== null && column.sources.length === 0) {
    return <NotConfigured platform={column.platform} />
  }

  return <Pane column={column} messages={messages} mode={mode} />
}

function Chats({ columns, mode }: { columns: ChatColumn[]; mode: ThemeMode }): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1">
      {columns.map((column, at) => (
        <div
          key={column.key}
          className="flex min-w-0 flex-1"
          style={{ borderLeft: at === 0 ? undefined : '1px solid var(--line)' }}
        >
          <Column column={column} mode={mode} />
        </div>
      ))}
    </div>
  )
}

export default function App(): React.ReactElement {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const openSettings = useStore((s) => s.openSettings)
  const sources = useStore((s) => s.sources)
  const visiblePlatforms = useStore((s) => s.visiblePlatforms)
  const togglePlatform = useStore((s) => s.togglePlatform)
  const merged = useStore((s) => s.merged)
  const toggleMerged = useStore((s) => s.toggleMerged)
  const themeChoice = useStore((s) => s.themeChoice)
  const systemDark = useStore((s) => s.systemDark)
  const setSystemDark = useStore((s) => s.setSystemDark)

  const mode = resolvedTheme(themeChoice, systemDark)

  const columns = useMemo(
    () => chatColumns(visiblePlatforms, sources, merged),
    [visiblePlatforms, sources, merged]
  )
  const setSources = useStore((s) => s.setSources)
  const setPlatforms = useStore((s) => s.setPlatforms)
  const ingest = useStore((s) => s.ingest)

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offPlatforms = api.onPlatforms(setPlatforms)

    // A renderer reload — after a crash, or the watchdog recovering a blank window —
    // starts with an empty store, so the replay main already keeps for OBS docks is
    // pulled back in rather than leaving the pane blank until the next message.
    void api.listSources().then((states) => {
      setSources(states)

      for (const state of states) {
        void api
          .sourceBacklog(state.id)
          .then((messages) => {
            if (messages.length > 0) ingest({ messages, moderation: [] })
          })
          .catch(() => {})
      }
    })

    void api
      .platforms()
      .then(setPlatforms)
      .catch((error: unknown) => console.debug('[platforms] unavailable:', error))

    return () => {
      offBatch()
      offSources()
      offPlatforms()
    }
  }, [ingest, setSources, setPlatforms])

  // The palette is stamped on the root rather than resolved in CSS, so 'system' has
  // one home and the OBS dock — a second entry that never stamps — stays dark.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    setSystemDark(media.matches)

    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches)

    media.addEventListener('change', onChange)

    return () => media.removeEventListener('change', onChange)
  }, [setSystemDark])

  useEffect(() => {
    document.documentElement.dataset.theme = mode
  }, [mode])

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        view={view}
        onView={setView}
        settingsOpen={settingsOpen}
        onOpenSettings={openSettings}
        sources={sources}
        visiblePlatforms={visiblePlatforms}
        merged={merged}
        onPlatform={togglePlatform}
        onMerged={toggleMerged}
      />

      <div className="relative flex min-h-0 flex-1">
        {view === 'chats' && <Chats columns={columns} mode={mode} />}
        {view === 'broadcast' && <Broadcast />}
        {settingsOpen && <SettingsModal />}
      </div>
    </div>
  )
}
