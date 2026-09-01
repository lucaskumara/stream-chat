import { useEffect, useRef, useState } from 'react'
import type { Platform } from '@shared/types'
import { bridge, remoteMessage } from '../bridge'
import { CONNECT_HINT, CONNECT_PLACEHOLDER, parseForPlatform } from '../connect'
import { PLATFORM_COLOR, PLATFORM_NAME } from '../theme'
import { useStore } from '../store'
import { PlatformMark } from './PlatformMark'

export interface ConnectChannelProps {
  platform: Platform
}

export function ConnectChannel({ platform }: ConnectChannelProps): React.ReactElement {
  const draft = useStore((s) => s.connectDraft[platform] ?? '')
  const setConnectDraft = useStore((s) => s.setConnectDraft)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setError(null)
    field.current?.focus()
  }, [platform])

  const connect = async (): Promise<void> => {
    const parsed = parseForPlatform(draft, platform)

    if (!parsed.ok || !parsed.ref) {
      setError(parsed.error ?? 'Could not understand that channel.')
      return
    }

    const ref = parsed.ref
    setError(null)
    setBusy(true)

    try {
      await bridge().api.addSource({
        platform: ref.platform,
        label: ref.label,
        identifier: ref.value
      })

      setConnectDraft(platform, '')
    } catch (err) {
      setError(remoteMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex min-w-0 flex-1 items-center justify-center px-[24px]"
      style={{ background: 'var(--ink-900)' }}
    >
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-[10px]">
          <span style={{ color: PLATFORM_COLOR[platform] }}>
            <PlatformMark platform={platform} height={20} />
          </span>

          <h2 className="m-0 text-[17px] font-semibold" style={{ color: 'var(--heading)' }}>
            {PLATFORM_NAME[platform]}
          </h2>
        </div>

        <p className="mt-[6px] mb-0 text-[14px]" style={{ color: 'var(--fg-3)' }}>
          Enter a channel to watch its chat here.
        </p>

        <div className="mt-[16px] flex gap-[8px]">
          <input
            ref={field}
            value={draft}
            spellCheck={false}
            aria-label={`${PLATFORM_NAME[platform]} channel`}
            placeholder={CONNECT_PLACEHOLDER[platform]}
            onChange={(event) => {
              setConnectDraft(platform, event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void connect()
            }}
            className="h-[34px] min-w-0 flex-1 px-[10px] text-[14px] outline-none"
            style={{
              background: 'var(--ink-800)',
              border: '1px solid var(--line-2)',
              borderRadius: 6,
              color: 'var(--fg)'
            }}
          />

          <button
            type="button"
            className="primary-button connect-submit h-[34px] flex-none px-[16px] text-[14px]"
            disabled={draft.trim() === '' || busy}
            onClick={() => void connect()}
          >
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>

        <p
          className="mt-[10px] mb-0 text-[13px]"
          style={{ color: error ? '#f08c8c' : 'var(--fg-4)' }}
        >
          {error ?? CONNECT_HINT[platform]}
        </p>
      </div>
    </div>
  )
}
