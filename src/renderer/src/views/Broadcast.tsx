import { useEffect, useState } from 'react'
import { Copy, Radio, Square } from 'lucide-react'
import type { BroadcastState, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { bridge } from '../bridge'
import { PlatformMark } from '../components/PlatformMark'
import { Toggle } from '../components/controls'
import { PLATFORM_COLOR } from '../theme'
import { useStore } from '../store'

const NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

export function Broadcast(): React.ReactElement {
  const platforms = useStore((s) => s.platforms)
  const setView = useStore((s) => s.setView)
  const setPane = useStore((s) => s.setSettingsPane)

  const [state, setState] = useState<BroadcastState | null>(null)
  const [chosen, setChosen] = useState<Platform[]>([])

  useEffect(() => {
    const { api } = bridge()

    void api.broadcast().then(setState)

    return api.onBroadcast(setState)
  }, [])

  /** A platform can be forwarded to once it has a key. Twitch and YouTube carry a fixed
      ingest, so in practice that is the moment the key is pasted. */
  const ready = PLATFORMS.filter((p) => platforms.find((c) => c.platform === p)?.hasStreamKey)

  useEffect(() => {
    setChosen((current) => {
      const kept = current.filter((p) => ready.includes(p))
      return kept.length === current.length ? current : kept
    })
  }, [ready.join(',')])

  const running = state?.running === true

  return (
    <div className="min-h-0 flex-1 overflow-y-auto chat-scroll" style={{ background: 'var(--ink-900)' }}>
      <div className="mx-auto max-w-[560px] px-[28px] py-[22px]">
        <h1 className="m-0 text-[17px] font-semibold" style={{ color: 'var(--heading)' }}>
          Broadcast
        </h1>
        <p className="mt-[4px] mb-[20px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
          Point OBS here once, and this forwards your stream to every platform you pick.
        </p>

        <div className="section-label mb-[8px]">In OBS · Settings → Stream → Custom</div>

        <div
          className="px-[14px] py-[12px]"
          style={{ border: '1px solid var(--line)', borderRadius: 9 }}
        >
          <CopyRow label="Server" value={state?.obsServer ?? ''} />
          <CopyRow label="Stream Key" value={state?.obsKey ?? ''} />

          <p className="mt-[10px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
            Set the keyframe interval to 2s and keep the bitrate at or below 6000 kbps —
            every platform receives the one encode OBS makes.
          </p>
        </div>

        <div className="section-label mt-[20px] mb-[8px]">Forward to</div>

        <div style={{ border: '1px solid var(--line)', borderRadius: 9 }}>
          {PLATFORMS.map((platform, at) => (
            <div
              key={platform}
              className="flex items-center gap-[12px] px-[14px] py-[11px]"
              style={{ borderTop: at === 0 ? undefined : '1px solid var(--line)' }}
            >
              <span
                className="flex h-[18px] w-[18px] flex-none items-center justify-center"
                style={{ color: ready.includes(platform) ? PLATFORM_COLOR[platform] : 'var(--fg-4)' }}
              >
                <PlatformMark platform={platform} height={13} />
              </span>

              <span className="flex-1 text-[14px]" style={{ color: 'var(--heading)' }}>
                {NAME[platform]}
              </span>

              {ready.includes(platform) ? (
                <Toggle
                  label={`Forward to ${NAME[platform]}`}
                  on={chosen.includes(platform)}
                  onChange={(on) =>
                    setChosen((current) =>
                      on ? [...current, platform] : current.filter((p) => p !== platform)
                    )
                  }
                />
              ) : (
                <button
                  type="button"
                  className="ghost-button h-[26px] flex-none px-[10px] text-[12px]"
                  onClick={() => {
                    setPane('platforms')
                    setView('settings')
                  }}
                >
                  Add a stream key
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={!running && chosen.length === 0}
          onClick={() => {
            const { api } = bridge()
            void (running ? api.broadcastStop() : api.broadcastStart(chosen))
          }}
          className="primary-button mt-[18px] flex h-[38px] w-full items-center justify-center gap-[8px] text-[14px]"
        >
          {running ? <Square size={14} strokeWidth={2} /> : <Radio size={15} strokeWidth={1.8} />}
          {running ? 'Stop forwarding' : 'Start forwarding'}
        </button>

        {running && (
          <p className="mt-[10px] mb-0 text-[13px]" style={{ color: 'var(--fg-3)' }}>
            Waiting for OBS. Press Start Streaming in OBS and it goes out to{' '}
            {state?.destinations.map((p) => NAME[p]).join(', ')}.
          </p>
        )}

        {state?.error && (
          <p className="mt-[10px] mb-0 text-[13px]" style={{ color: 'var(--error)' }}>
            {state.error}
          </p>
        )}
      </div>
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  return (
    <div className="mt-[10px] flex items-center gap-[10px] first:mt-0">
      <span className="w-[92px] flex-none text-[13px]" style={{ color: 'var(--fg-3)' }}>
        {label}
      </span>

      <span
        className="inset-field min-w-0 flex-1 truncate px-[10px] text-[13px]"
        style={{ height: 30, lineHeight: '30px', color: 'var(--fg)' }}
        title={value}
      >
        {value}
      </span>

      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="ghost-button flex h-[30px] w-[30px] flex-none items-center justify-center p-0"
        onClick={() => {
          void bridge().api.copyText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        <Copy size={13} strokeWidth={1.8} />
      </button>

      <span
        className="w-[42px] flex-none text-[12px]"
        style={{ color: 'var(--fg-4)', opacity: copied ? 1 : 0 }}
      >
        Copied
      </span>
    </div>
  )
}
