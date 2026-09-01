import { useCallback, useEffect, useState } from 'react'
import type { SourceState } from '@shared/types'
import { bridge } from './bridge'
import { useStore } from './store'
import { AddChannel } from './components/AddChannel'
import { ChatPane } from './components/ChatPane'
import { EmptyBlock } from './components/controls'
import { TitleBar } from './components/TitleBar'
import { Broadcast } from './views/Broadcast'
import { Settings } from './views/Settings'

const EMPTY_TERMS: string[] = []

function Chats({ onAdd }: { onAdd: () => void }): React.ReactElement {
  const s = useStore()

  const panes = s.sources.filter((source) => s.visibleIds.includes(source.id))

  if (s.sources.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ background: 'var(--ink-900)' }}
      >
        <EmptyBlock
          size={34}
          title="No channels yet"
          detail="Add one by name, or paste its link."
        >
          <button
            type="button"
            className="ghost-button h-[32px] px-[14px] text-[14px]"
            style={{ background: 'var(--ink-600)', borderRadius: 7, color: 'var(--fg)' }}
            onClick={onAdd}
          >
            Add a channel
          </button>
        </EmptyBlock>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      {panes.map((source, at) => (
        <div
          key={source.id}
          className="flex min-w-0 flex-1"
          style={{ borderLeft: at === 0 ? undefined : '1px solid var(--line)' }}
        >
          <ChatPane
            source={source}
            messages={s.bySource[source.id] ?? []}
            deleted={s.deleted}
            showDeleted={s.showDeleted}
            showTimestamps={s.showTimestamps}
            density={s.density}
            filterOpen={s.filterOpen[source.id] === true}
            gearOpen={s.gearOpenFor === source.id}
            onToggleFilter={() => s.toggleFilter(source.id)}
            onToggleGear={() => s.toggleGear(source.id)}
            searchTerms={s.search[source.id] ?? EMPTY_TERMS}
            searchDraft={s.searchDraft[source.id] ?? ''}
            onSearchTerms={(terms) => s.setSearch(source.id, terms)}
            onSearchDraft={(draft) => s.setSearchDraft(source.id, draft)}
            onAddSearchTerm={(term) => s.addSearchTerm(source.id, term)}
            fontSize={s.fontSize[source.id] ?? s.defaultFontSize}
            onFontStep={(steps) => s.stepFontSize(source.id, steps)}
            onFontReset={() => s.resetFontSize(source.id)}
            onClear={() => {
              s.clearSource(source.id)
              s.closeGear()
            }}
          />
        </div>
      ))}
    </div>
  )
}

export default function App(): React.ReactElement {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const sources = useStore((s) => s.sources)
  const visibleIds = useStore((s) => s.visibleIds)
  const setSources = useStore((s) => s.setSources)
  const setTwitchAuth = useStore((s) => s.setTwitchAuth)
  const ingest = useStore((s) => s.ingest)
  const forgetSource = useStore((s) => s.forgetSource)
  const showSource = useStore((s) => s.showSource)
  const toggleSplit = useStore((s) => s.toggleSplit)

  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offAuth = api.onTwitchAuth(setTwitchAuth)

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
      .twitchAuthState()
      .then(setTwitchAuth)
      .catch((error) => console.debug('[auth] state unavailable:', error))

    return () => {
      offBatch()
      offSources()
      offAuth()
    }
  }, [ingest, setSources, setTwitchAuth])

  const remove = useCallback(
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
        visibleIds={visibleIds}
        onSelect={showSource}
        onSplit={toggleSplit}
        onRemove={remove}
        onAdd={() => setAdding(true)}
      />

      {view === 'chats' && <Chats onAdd={() => setAdding(true)} />}
      {view === 'broadcast' && <Broadcast />}
      {view === 'settings' && <Settings />}

      {adding && <AddChannel onClose={() => setAdding(false)} />}
    </div>
  )
}
