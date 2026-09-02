import { useCallback, useEffect, useMemo } from 'react'
import type { ChatMessage, SourceState } from '@shared/types'
import { bridge } from './bridge'
import { chatColumns, columnLabel, columnPaneId, type ChatColumn } from './layout'
import { resolvedTheme, type ThemeMode } from './theme'
import { mergeMessages } from './merge'
import { useStore } from './store'
import { ChatPane } from './components/ChatPane'
import { ConnectChannel } from './components/ConnectChannel'
import { TitleBar } from './components/TitleBar'
import { Broadcast } from './views/Broadcast'
import { Settings } from './views/Settings'

const EMPTY_TERMS: string[] = []
const EMPTY_MESSAGES: ChatMessage[] = []

function Pane({
  column,
  messages,
  mode,
  onDisconnect
}: {
  column: ChatColumn
  messages: ChatMessage[]
  mode: ThemeMode
  onDisconnect: (source: SourceState) => void
}): React.ReactElement {
  const s = useStore()

  const paneId = columnPaneId(column)
  const { sources } = column

  return (
    <ChatPane
      sources={sources}
      label={columnLabel(column)}
      showPlatform={sources.length > 1}
      messages={messages}
      deleted={s.deleted}
      accounts={s.accounts}
      showDeleted={s.showDeleted}
      showTimestamps={s.showTimestamps}
      density={s.density}
      mode={mode}
      filterOpen={s.filterOpen[paneId] === true}
      gearOpen={s.gearOpenFor === paneId}
      onToggleFilter={() => s.toggleFilter(paneId)}
      onToggleGear={() => s.toggleGear(paneId)}
      searchTerms={s.search[paneId] ?? EMPTY_TERMS}
      searchDraft={s.searchDraft[paneId] ?? ''}
      onSearchTerms={(terms) => s.setSearch(paneId, terms)}
      onSearchDraft={(draft) => s.setSearchDraft(paneId, draft)}
      onAddSearchTerm={(term) => s.addSearchTerm(paneId, term)}
      fontSize={s.fontSize[paneId] ?? s.defaultFontSize}
      onFontStep={(steps) => s.stepFontSize(paneId, steps)}
      onFontReset={() => s.resetFontSize(paneId)}
      onClear={() => {
        for (const source of sources) s.clearSource(source.id)
        s.closeGear()
      }}
      onDisconnect={() => {
        if (sources.length === 1) onDisconnect(sources[0])
      }}
    />
  )
}

function Column({
  column,
  mode,
  onDisconnect
}: {
  column: ChatColumn
  mode: ThemeMode
  onDisconnect: (source: SourceState) => void
}): React.ReactElement {
  const bySource = useStore((s) => s.bySource)

  const messages = useMemo(
    () => mergeMessages(column.sources.map((source) => bySource[source.id] ?? EMPTY_MESSAGES)),
    [column, bySource]
  )

  if (column.platform !== null && column.sources.length === 0) {
    return <ConnectChannel platform={column.platform} />
  }

  return <Pane column={column} messages={messages} mode={mode} onDisconnect={onDisconnect} />
}

function Chats({
  columns,
  mode,
  onDisconnect
}: {
  columns: ChatColumn[]
  mode: ThemeMode
  onDisconnect: (source: SourceState) => void
}): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1">
      {columns.map((column, at) => (
        <div
          key={column.key}
          className="flex min-w-0 flex-1"
          style={{ borderLeft: at === 0 ? undefined : '1px solid var(--line)' }}
        >
          <Column column={column} mode={mode} onDisconnect={onDisconnect} />
        </div>
      ))}
    </div>
  )
}

export default function App(): React.ReactElement {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
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
  const setAccounts = useStore((s) => s.setAccounts)
  const ingest = useStore((s) => s.ingest)
  const forgetSource = useStore((s) => s.forgetSource)

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offAccounts = api.onAccounts(setAccounts)

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
      .accounts()
      .then(setAccounts)
      .catch((error) => console.debug('[accounts] state unavailable:', error))

    return () => {
      offBatch()
      offSources()
      offAccounts()
    }
  }, [ingest, setSources, setAccounts])

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

  const disconnect = useCallback(
    (source: SourceState) => {
      void bridge().api.removeSource(source.id)
      forgetSource(source.id)
    },
    [forgetSource]
  )

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        view={view}
        onView={setView}
        sources={sources}
        visiblePlatforms={visiblePlatforms}
        merged={merged}
        onPlatform={togglePlatform}
        onMerged={toggleMerged}
      />

      {view === 'chats' && <Chats columns={columns} mode={mode} onDisconnect={disconnect} />}
      {view === 'broadcast' && <Broadcast />}
      {view === 'settings' && <Settings />}
    </div>
  )
}
