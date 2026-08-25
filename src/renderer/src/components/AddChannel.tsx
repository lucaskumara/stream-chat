import { useMemo, useState } from 'react'
import type { Platform } from '@shared/types'
import { AUTO_CONNECT_COST, parseChannelInput } from '@shared/channel'
import { bridge } from '../bridge'

/** Providers that actually exist. The rest are listed but explain themselves. */
const READY: Record<Platform, boolean> = {
  twitch: true,
  youtube: false,
  kick: false,
  mock: true
}

const PHASE_NOTE: Partial<Record<Platform, string>> = {
  youtube: 'YouTube arrives in Phase 3, with the quota strategy decided then.',
  kick: 'Kick arrives in Phase 4, over its unofficial socket.'
}

const AUTO_LABEL: Record<'push' | 'polled' | 'none', string> = {
  push: 'auto-connects when live (push, no polling)',
  polled: 'liveness is polled — costs API quota',
  none: 'synthetic traffic'
}

/**
 * One box for every platform. Accepts a pasted channel/video URL, a bare name
 * plus the platform dropdown, or `twitch:name`. Parsing lives in shared/ so the
 * main process can reuse the same rules.
 */
export function AddChannel(): React.ReactElement {
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('twitch')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Live feedback as they type, so a pasted link visibly resolves.
  const preview = useMemo(() => {
    if (input.trim() === '') return null
    const parsed = parseChannelInput(input, platform)
    return parsed.ok && parsed.ref ? parsed.ref : null
  }, [input, platform])

  const effectivePlatform = preview?.platform ?? platform

  const submit = async (): Promise<void> => {
    setError(null)
    const parsed = parseChannelInput(input, platform)

    if (!parsed.ok || !parsed.ref) {
      setError(parsed.error ?? 'Could not understand that channel.')
      return
    }

    const ref = parsed.ref
    if (!READY[ref.platform]) {
      setError(PHASE_NOTE[ref.platform] ?? `${ref.platform} is not supported yet.`)
      return
    }
    setBusy(true)
    try {
      await bridge().api.addSource({
        platform: ref.platform,
        label: ref.label,
        identifier: ref.value
      })
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-[6px] border-t border-[#232932] p-2">
      <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        Add a channel
      </div>

      <div className="flex gap-1">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className="rounded border border-[#2b323d] bg-[#0b0d10] px-1 py-1 text-[12px] text-slate-300 outline-none focus:border-indigo-500"
          title="platform for bare names — pasted links detect their own"
        >
          <option value="twitch">twitch</option>
          <option value="youtube">youtube</option>
          <option value="kick">kick</option>
        </select>

        <input
          type="text"
          value={input}
          spellCheck={false}
          placeholder="name or paste a link"
          onChange={(e) => {
            setInput(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          className="min-w-0 flex-1 rounded border border-[#2b323d] bg-[#0b0d10] px-[6px] py-1 text-[12px] text-slate-200 outline-none focus:border-indigo-500"
        />

        <button
          type="button"
          disabled={busy || input.trim() === ''}
          onClick={() => void submit()}
          className="cursor-pointer rounded bg-indigo-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          add
        </button>
      </div>

      {preview && (
        <div className="space-y-[2px]">
          <div className="truncate text-[11px] text-slate-500">
            <span className="text-slate-400">{preview.platform}</span> · {preview.value} ·{' '}
            {AUTO_LABEL[AUTO_CONNECT_COST[preview.platform]]}
          </div>
          {preview.kind === 'youtube-video-id' && (
            <div className="text-[11px] leading-relaxed text-amber-500/70">
              That link names one broadcast. Add the @handle instead to follow the channel
              across streams.
            </div>
          )}
        </div>
      )}

      {!preview && input.trim() !== '' && (
        <div className="text-[11px] text-slate-600">
          Paste a twitch.tv / youtube.com / kick.com link, or pick a platform above.
        </div>
      )}

      {!READY[effectivePlatform] && (
        <div className="text-[11px] leading-relaxed text-amber-500/80">
          {PHASE_NOTE[effectivePlatform]}
        </div>
      )}

      {error && <div className="text-[11px] leading-relaxed text-red-400">{error}</div>}
    </div>
  )
}
