import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff } from 'lucide-react'
import type { BroadcastState, DestinationState, Platform } from '@shared/types'
import { PLATFORMS, REQUIRED_KEYFRAME_SECONDS } from '@shared/types'
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

  useEffect(() => {
    const { api } = bridge()

    void api.broadcast().then(setState)

    return api.onBroadcast(setState)
  }, [])

  /** A platform can be forwarded to once it has a key. Twitch and YouTube carry a fixed
      ingest, so in practice that is the moment the key is pasted. */
  const ready = PLATFORMS.filter((p) => platforms.find((c) => c.platform === p)?.hasStreamKey)

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
          <CopyRow label="Stream Key" value={state?.obsKey ?? ''} secret />

          <p className="mt-[10px] mb-0 text-[12px]" style={{ color: 'var(--fg-4)' }}>
            Set the keyframe interval to {REQUIRED_KEYFRAME_SECONDS}s and keep the bitrate at
            or below 6000 kbps — every platform receives the one encode OBS makes.
          </p>
        </div>

        <Signal state={state} />

        <KeyframeWarning state={state} />

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

              <div className="min-w-0 flex-1">
                <div className="text-[14px]" style={{ color: 'var(--heading)' }}>
                  {NAME[platform]}
                </div>
                <DestinationLine state={state} platform={platform} />
              </div>

              {ready.includes(platform) ? (
                <Toggle
                  label={`Forward to ${NAME[platform]}`}
                  on={platforms.find((c) => c.platform === platform)?.forward === true}
                  onChange={(on) => void bridge().api.savePlatform(platform, { forward: on })}
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

        {state?.error && (
          <p className="mt-[12px] mb-0 text-[13px]" style={{ color: 'var(--error)' }}>
            {state.error}
          </p>
        )}
      </div>
    </div>
  )
}

/** Kick runs on Amazon IVS, which requires a 2s keyframe interval and simply never goes
    live above it — the push is accepted, the bytes are read, and nothing happens. That is
    unguessable from the outside, so the interval is measured from the stream and said
    plainly. Twitch tolerates a long interval, which is what makes it look like Kick is
    broken rather than the encoder being misconfigured. */
function KeyframeWarning({ state }: { state: BroadcastState | null }): React.ReactElement | null {
  const seconds = state?.keyframeSeconds
  if (!seconds || seconds <= REQUIRED_KEYFRAME_SECONDS + 0.5) return null

  return (
    <div
      className="mt-[10px] px-[14px] py-[11px] text-[13px]"
      style={{
        border: '1px solid var(--error)',
        borderRadius: 9,
        color: 'var(--error)'
      }}
    >
      OBS is sending a keyframe every {seconds.toFixed(1)}s. Kick needs{' '}
      {REQUIRED_KEYFRAME_SECONDS}s and will accept the stream without ever going live above
      that. Set Output → Streaming → Keyframe Interval to {REQUIRED_KEYFRAME_SECONDS} and
      restart the stream.
    </div>
  )
}

/** Whether OBS is actually sending, reported separately from where it is going. The relay
    listens from launch, so this answers "is my encoder set up right?" before any platform
    is switched on. */
function Signal({ state }: { state: BroadcastState | null }): React.ReactElement {
  const receiving = state?.receiving === true

  return (
    <div
      className="mt-[10px] flex items-center gap-[9px] px-[14px] py-[11px]"
      style={{ border: '1px solid var(--line)', borderRadius: 9 }}
    >
      <span
        aria-hidden
        className="h-[8px] w-[8px] flex-none rounded-full"
        style={{ background: receiving ? '#3fb950' : 'var(--line-2)' }}
      />

      <span className="flex-1 text-[14px]" style={{ color: 'var(--heading)' }}>
        {receiving ? 'Receiving from OBS' : 'No signal from OBS'}
      </span>

      <span className="text-[12px]" style={{ color: 'var(--fg-4)' }}>
        {receiving
          ? 'switch a platform on to send it'
          : state?.listening
            ? 'press Go Live in OBS'
            : 'not listening'}
      </span>
    </div>
  )
}

const DESTINATION_LINE: Record<DestinationState, string> = {
  off: '',
  connecting: 'Connecting…',
  sending: 'Sending',
  error: ''
}

function DestinationLine({
  state,
  platform
}: {
  state: BroadcastState | null
  platform: Platform
}): React.ReactElement | null {
  const found = state?.destinations.find((d) => d.platform === platform)
  if (!found) return null

  const text = found.state === 'error' ? (found.error ?? 'Failed') : DESTINATION_LINE[found.state]
  if (!text) return null

  return (
    <div
      className="truncate text-[12px]"
      style={{ color: found.state === 'error' ? 'var(--error)' : 'var(--fg-4)' }}
      title={text}
    >
      {text}
    </div>
  )
}

/** This is a streamer's app, so its own window ends up on stream — in a "how I'm set up"
    segment, in a screen share, in a clip. A key sitting in plain text on the page is a key
    handed to the audience, and the relay key is what lets anything on the machine push
    into the fan-out. It is masked until asked for; copying never needs it revealed. */
function masked(value: string): string {
  return value === '' ? '' : '•'.repeat(Math.min(value.length, 24))
}

function CopyRow({
  label,
  value,
  secret
}: {
  label: string
  value: string
  secret?: boolean
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(false)

  const hidden = secret === true && !shown

  return (
    <div className="mt-[10px] flex items-center gap-[10px] first:mt-0">
      <span className="w-[92px] flex-none text-[13px]" style={{ color: 'var(--fg-3)' }}>
        {label}
      </span>

      <span
        className="inset-field min-w-0 flex-1 truncate px-[10px] text-[13px]"
        style={{
          height: 30,
          lineHeight: '30px',
          color: hidden ? 'var(--fg-4)' : 'var(--fg)',
          letterSpacing: hidden ? '0.15em' : undefined
        }}
        title={hidden ? undefined : value}
      >
        {hidden ? masked(value) : value}
      </span>

      {secret && (
        <button
          type="button"
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          className="ghost-button flex h-[30px] w-[30px] flex-none items-center justify-center p-0"
          onClick={() => setShown((was) => !was)}
        >
          {shown ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
        </button>
      )}

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
