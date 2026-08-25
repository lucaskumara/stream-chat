import { useEffect, useMemo, useState } from 'react'
import type { SourceState, ViewMode } from '@shared/types'
import { bridge } from './bridge'
import { createRuleEngine } from './rules'
import { useStore } from './store'
import { ChatPane, useThroughput } from './components/ChatPane'
import { PLATFORM_COLOR } from './components/MessageRow'
import { RulesPanel } from './components/RulesPanel'
import { ConnectionsPanel } from './components/ConnectionsPanel'
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
      {source.live && <span className="shrink-0 text-[11px] text-red-400">LIVE</span>}
      <span className="ml-auto shrink-0 text-[12px] tabular-nums text-slate-600">{count}</span>
    </div>
  )
}

function CombinedHeader(): React.ReactElement {
  const count = useStore((s) => s.combined.length)
  const sources = useStore((s) => s.sources)
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-[#232932] bg-[#0f1216] px-2 py-1">
      <span className="text-[14px] font-medium text-slate-200">Combined</span>
      <div className="flex gap-1">
        {sources.map((source) => (
          <span
            key={source.id}
            title={source.label}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: PLATFORM_COLOR[source.platform] }}
          />
        ))}
      </div>
      <span className="ml-auto text-[12px] tabular-nums text-slate-600">{count}</span>
    </div>
  )
}

type SidePanel = 'none' | 'rules' | 'connections'

interface TopBarProps {
  panel: SidePanel
  setPanel: (panel: SidePanel) => void
}

function TopBar({ panel, setPanel }: TopBarProps): React.ReactElement {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const showDeleted = useStore((s) => s.showDeleted)
  const toggleShowDeleted = useStore((s) => s.toggleShowDeleted)
  const showTimestamps = useStore((s) => s.showTimestamps)
  const toggleTimestamps = useStore((s) => s.toggleTimestamps)
  const capacity = useStore((s) => s.capacity)
  const setCapacity = useStore((s) => s.setCapacity)
  const received = useStore((s) => s.received)
  const fontSize = useStore((s) => s.fontSize)
  const stepFontSize = useStore((s) => s.stepFontSize)

  const rate = useThroughput(received)
  const mode = bridge().mode

  const tab = (mode_: ViewMode, label: string): React.ReactElement => (
    <button
      type="button"
      onClick={() => setView(mode_)}
      className={
        'cursor-pointer rounded px-2 py-[3px] text-[13px] font-medium ' +
        (view === mode_ ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-[#232932]')
      }
    >
      {label}
    </button>
  )

  const toggle = (on: boolean, label: string, onClick: () => void): React.ReactElement => (
    <button
      type="button"
      onClick={onClick}
      className={
        'cursor-pointer rounded px-2 py-[3px] text-[13px] ' +
        (on ? 'bg-[#232932] text-slate-200' : 'text-slate-500 hover:bg-[#232932]')
      }
    >
      {label}
    </button>
  )

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-[#232932] bg-[#0f1216] px-2 py-[6px]">
      <span className="mr-1 text-[14px] font-semibold text-slate-300">stream-chat</span>

      <div className="flex gap-1 rounded bg-[#0b0d10] p-[2px]">
        {tab('panes', 'Panes')}
        {tab('combined', 'Combined')}
      </div>

      <input
        type="search"
        value={search}
        placeholder="filter messages..."
        onChange={(e) => setSearch(e.target.value)}
        className="w-56 rounded border border-[#2b323d] bg-[#0b0d10] px-[6px] py-[3px] text-[14px] text-slate-200 outline-none focus:border-indigo-500"
      />

      {toggle(showTimestamps, 'time', toggleTimestamps)}
      {toggle(showDeleted, 'deleted', toggleShowDeleted)}

      <div className="flex items-center gap-1 text-[12px] text-slate-500">
        <span>text</span>
        <button
          type="button"
          onClick={() => stepFontSize(-1)}
          className="cursor-pointer rounded bg-[#0b0d10] px-[6px] py-[2px] text-slate-300 hover:bg-[#232932]"
          title="smaller chat text"
        >
          A-
        </button>
        <span className="w-6 text-center tabular-nums text-slate-300">{fontSize}</span>
        <button
          type="button"
          onClick={() => stepFontSize(1)}
          className="cursor-pointer rounded bg-[#0b0d10] px-[6px] py-[2px] text-slate-300 hover:bg-[#232932]"
          title="larger chat text"
        >
          A+
        </button>
      </div>

      <label className="flex items-center gap-1 text-[12px] text-slate-500">
        buffer
        <input
          type="number"
          min={50}
          max={5000}
          step={50}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          className="w-16 rounded border border-[#2b323d] bg-[#0b0d10] px-1 py-[2px] text-[13px] tabular-nums text-slate-300 outline-none focus:border-indigo-500"
        />
      </label>

      <div className="ml-auto flex items-center gap-3 text-[12px] tabular-nums text-slate-500">
        <span title="messages received per second">
          <span className="text-slate-300">{rate}</span> msg/s
        </span>
        <span title="messages received this session">
          <span className="text-slate-300">{received.toLocaleString()}</span> total
        </span>
        <span
          className={mode === 'electron' ? 'text-emerald-500' : 'text-amber-500'}
          title={
            mode === 'electron'
              ? 'connected to the main process over IPC'
              : 'no preload bridge - running the in-page simulator'
          }
        >
          {mode}
        </span>
      </div>

      {toggle(panel === 'connections', 'connections', () =>
        setPanel(panel === 'connections' ? 'none' : 'connections')
      )}
      {toggle(panel === 'rules', 'rules', () => setPanel(panel === 'rules' ? 'none' : 'rules'))}
    </header>
  )
}

export default function App(): React.ReactElement {
  const sources = useStore((s) => s.sources)
  const setSources = useStore((s) => s.setSources)
  const ingest = useStore((s) => s.ingest)
  const bySource = useStore((s) => s.bySource)
  const combined = useStore((s) => s.combined)
  const deleted = useStore((s) => s.deleted)
  const rules = useStore((s) => s.rules)
  const view = useStore((s) => s.view)
  const search = useStore((s) => s.search)
  const showDeleted = useStore((s) => s.showDeleted)
  const showTimestamps = useStore((s) => s.showTimestamps)

  const [panel, setPanel] = useState<SidePanel>('none')
  const fontSize = useStore((s) => s.fontSize)

  // One CSS variable drives every message-row size, so changing it re-styles
  // scrollback without re-rendering a single row.
  useEffect(() => {
    document.documentElement.style.setProperty('--chat-font-size', `${fontSize}px`)
  }, [fontSize])

  // Rebuilding the engine is what invalidates its memo cache, so this must key
  // off the rules array identity and nothing else.
  const engine = useMemo(() => createRuleEngine(rules), [rules])

  const setTwitchAuth = useStore((s) => s.setTwitchAuth)

  useEffect(() => {
    const { api } = bridge()
    const offBatch = api.onBatch(ingest)
    const offSources = api.onSources(setSources)
    const offAuth = api.onTwitchAuth(setTwitchAuth)

    void api.listSources().then(setSources)
    void api.twitchAuthState().then(setTwitchAuth).catch(() => undefined)

    return () => {
      offBatch()
      offSources()
      offAuth()
    }
  }, [ingest, setSources, setTwitchAuth])

  const shared = { engine, deleted, showDeleted, showTimestamps, search }

  return (
    <div className="flex h-full flex-col">
      <TopBar panel={panel} setPanel={setPanel} />

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="flex min-h-0 min-w-0 flex-1">
          {view === 'combined' ? (
            <ChatPane {...shared} messages={combined} showPlatform header={<CombinedHeader />} />
          ) : sources.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-slate-600">
              Add a source to start.
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-[#232932]">
              {sources.map((source) => (
                <ChatPane
                  key={source.id}
                  {...shared}
                  messages={bySource[source.id] ?? []}
                  showPlatform={false}
                  header={<PaneHeader source={source} />}
                />
              ))}
            </div>
          )}
        </main>

        {panel === 'rules' && <RulesPanel engine={engine} />}
        {panel === 'connections' && <ConnectionsPanel />}
      </div>
    </div>
  )
}
