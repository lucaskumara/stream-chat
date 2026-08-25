import { useState } from 'react'
import type { Platform, SourceState, SourceStatus } from '@shared/types'
import { bridge } from '../bridge'
import { useStore } from '../store'
import { PLATFORM_COLOR } from './MessageRow'
import { AddChannel } from './AddChannel'

const STATUS_COLOR: Record<SourceStatus, string> = {
  connected: '#22c55e',
  connecting: '#eab308',
  disconnected: '#64748b',
  offline: '#64748b',
  error: '#ef4444'
}

function SourceRow({ source }: { source: SourceState }): React.ReactElement {
  const clearSource = useStore((s) => s.clearSource)
  const forgetSource = useStore((s) => s.forgetSource)
  const count = useStore((s) => s.bySource[source.id]?.length ?? 0)
  const [rate, setRate] = useState(5)

  const isMock = source.platform === 'mock'

  const remove = async (): Promise<void> => {
    await bridge().api.removeSource(source.id)
    forgetSource(source.id)
  }

  const changeRate = (next: number): void => {
    setRate(next)
    void bridge().api.setRate(source.id, next)
  }

  return (
    <div className="rounded border border-[#232932] bg-[#171b22] p-2">
      <div className="flex items-center gap-[6px]">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: PLATFORM_COLOR[source.platform] }}
          title={source.platform}
        />
        <span className="truncate text-[14px] font-medium text-slate-200">{source.label}</span>
        <span
          className="ml-auto h-[6px] w-[6px] shrink-0 rounded-full"
          style={{ backgroundColor: STATUS_COLOR[source.status] }}
          title={source.error ?? source.status}
        />
      </div>

      <div className="mt-1 flex items-center gap-2 text-[12px] text-slate-500">
        <span>{source.status}</span>
        {source.live ? (
          <span className="text-red-400">● LIVE</span>
        ) : (
          source.status === 'connected' && <span className="text-slate-600">offline</span>
        )}
        <span className="ml-auto tabular-nums">{count} held</span>
      </div>

      {source.error && (
        <div className="mt-1 text-[11px] leading-relaxed text-red-400" title={source.error}>
          {source.error}
        </div>
      )}

      {!source.live && source.status === 'connected' && !isMock && (
        <div className="mt-1 text-[11px] text-slate-600">
          Subscribed — chat starts automatically when they go live.
        </div>
      )}

      {isMock && (
        <div className="mt-[6px] flex items-center gap-1">
          <input
            type="range"
            min={0}
            max={200}
            value={rate}
            onChange={(e) => changeRate(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer"
            title="synthetic messages per second"
          />
          <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-slate-500">
            {rate}/s
          </span>
        </div>
      )}

      <div className="mt-1 flex gap-1">
        <button
          type="button"
          onClick={() => clearSource(source.id)}
          className="flex-1 cursor-pointer rounded bg-[#232932] py-[2px] text-[12px] text-slate-400 hover:bg-[#2b323d] hover:text-slate-200"
        >
          clear
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          className="flex-1 cursor-pointer rounded bg-[#232932] py-[2px] text-[12px] text-slate-400 hover:bg-red-500/25 hover:text-red-300"
        >
          remove
        </button>
      </div>
    </div>
  )
}

function DevTools(): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const addMock = async (count: number, each: number): Promise<void> => {
    setBusy(true)
    try {
      for (let i = 0; i < count; i++) {
        await bridge().api.addSource({ platform: 'mock' as Platform, label: '', rate: each })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-[#232932] p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full cursor-pointer text-left text-[11px] font-semibold tracking-wide text-slate-600 uppercase hover:text-slate-400"
      >
        {open ? '▾' : '▸'} mock traffic
      </button>

      {open && (
        <div className="mt-[6px] space-y-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void addMock(1, 25)}
            className="w-full cursor-pointer rounded bg-[#232932] py-1 text-[12px] text-slate-300 hover:bg-[#2b323d] disabled:opacity-40"
          >
            add one mock source (25/s)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void addMock(4, 50)}
            title="4 sources at 50 msg/sec each — the Phase 0 load target"
            className="w-full cursor-pointer rounded bg-[#232932] py-1 text-[12px] text-slate-300 hover:bg-[#2b323d] disabled:opacity-40"
          >
            load test: 4 × 50/s
          </button>
        </div>
      )}
    </div>
  )
}

function TwitchModeLine(): React.ReactElement {
  const auth = useStore((s) => s.twitchAuth)
  const signedIn = auth.status === 'signed-in'

  return (
    <div className="flex items-center gap-1 border-t border-[#232932] px-2 py-[6px] text-[11px] text-slate-600">
      <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ backgroundColor: '#9146ff' }} />
      <span className="truncate">
        {signedIn ? `twitch: ${auth.login}` : 'twitch: anonymous'}
      </span>
      {signedIn && (
        <button
          type="button"
          onClick={() => void bridge().api.twitchSignOut()}
          className="ml-auto shrink-0 cursor-pointer text-slate-600 underline underline-offset-2 hover:text-slate-400"
          title="chat still works signed out; you lose badge images and the live indicator"
        >
          sign out
        </button>
      )}
    </div>
  )
}

export function Sidebar(): React.ReactElement {
  const sources = useStore((s) => s.sources)

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#232932] bg-[#0f1216]">
      <div className="chat-scroll flex-1 overflow-y-auto">
        <div className="p-2">
          <div className="mb-[6px] text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Channels
          </div>
          <div className="space-y-2">
            {sources.length === 0 && (
              <p className="text-[12px] leading-relaxed text-slate-600">
                No channels yet. Add one below by name, or paste its link.
              </p>
            )}
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </div>
        </div>
      </div>

      <AddChannel />
      <TwitchModeLine />
      <DevTools />
    </aside>
  )
}
