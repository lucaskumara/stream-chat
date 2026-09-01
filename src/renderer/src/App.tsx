import { useCallback, useEffect } from 'react'
import type { SourceState } from '@shared/types'
import { bridge } from './bridge'
import { useStore } from './store'
import { ChatPane } from './components/ChatPane'
import { ConnectChannel } from './components/ConnectChannel'
import { TitleBar } from './components/TitleBar'
import { Broadcast } from './views/Broadcast'
import { Settings } from './views/Settings'

const EMPTY_TERMS: string[] = []

function Chats({ onDisconnect }: { onDisconnect: (source: SourceState) => void }): React.ReactElement {
  const s = useStore()

  const source = s.sources.find((held) => held.platform === s.activePlatform)

  if (!source) return <ConnectChannel platform={s.activePlatform} />

  return (
    <div className="flex min-h-0 flex-1">
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
        onDisconnect={() => onDisconnect(source)}
      />
    </div>
  )
}

export default function App(): React.ReactElement {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const sources = useStore((s) => s.sources)
  const activePlatform = useStore((s) => s.activePlatform)
  const setActivePlatform = useStore((s) => s.setActivePlatform)
  const setSources = useStore((s) => s.setSources)
  const setTwitchAuth = useStore((s) => s.setTwitchAuth)
  const ingest = useStore((s) => s.ingest)
  const forgetSource = useStore((s) => s.forgetSource)

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
        activePlatform={activePlatform}
        onPlatform={setActivePlatform}
      />

      {view === 'chats' && <Chats onDisconnect={disconnect} />}
      {view === 'broadcast' && <Broadcast />}
      {view === 'settings' && <Settings />}
    </div>
  )
}
