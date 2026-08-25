import { useEffect } from 'react'
import type { SourceState } from '@shared/types'
import { bridge } from './bridge'
import { useStore } from './store'
import { ChatPane } from './components/ChatPane'
import { PLATFORM_COLOR } from './components/MessageRow'
import { Sidebar } from './components/Sidebar'

function PaneHeader({ source }: { source: SourceState }): React.ReactElement {
  const count = useStore((s) => s.bySource[source.id]?.length ?? 0)
  return (
    <div className="flex shrink-0 items-center gap-[6px] border-b border-[#232932] bg-[#0f1216] px-2 py-1">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: PLATFORM_COLOR[source.platform] }}
      />
      <span className="truncate text-[14px] font-medium text-slate-200">{source.label}</span>
      {source.live === true && (
        <span className="shrink-0 text-[11px] text-red-400">LIVE</span>
      )}
      <span className="ml-auto shrink-0 text-[12px] tabular-nums text-slate-600">{count}</span>
    </div>
  )
}

export default function App(): React.ReactElement {
  const sources = useStore((s) => s.sources)
  const setSources = useStore((s) => s.setSources)
  const setTwitchAuth = useStore((s) => s.setTwitchAuth)
  const ingest = useStore((s) => s.ingest)
  const bySource = useStore((s) => s.bySource)
  const deleted = useStore((s) => s.deleted)
  const showDeleted = useStore((s) => s.showDeleted)
  const showTimestamps = useStore((s) => s.showTimestamps)
  const fontSize = useStore((s) => s.fontSize)

  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`)
  }, [fontSize])

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offAuth = api.onTwitchAuth(setTwitchAuth)

    void api.listSources().then(setSources)
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

  return (
    <div className="flex h-full min-h-0">
      <Sidebar />

      <main className="flex min-h-0 min-w-0 flex-1">
        {sources.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] leading-relaxed text-slate-600">
            Add a channel on the left to start watching chat.
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-[#232932]">
            {sources.map((source) => (
              <ChatPane
                key={source.id}
                deleted={deleted}
                showDeleted={showDeleted}
                showTimestamps={showTimestamps}
                search=""
                messages={bySource[source.id] ?? []}
                emoteSettings={source.emotes}
                showPlatform={false}
                header={<PaneHeader source={source} />}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
