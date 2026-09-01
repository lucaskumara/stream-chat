import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Platform } from '@shared/types'
import { parseChannelInput } from '@shared/channel'
import { bridge, remoteMessage } from '../bridge'
import { PLATFORM_COLOR } from './PlatformIcon'

const PLATFORM_NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

const PLATFORMS = Object.keys(PLATFORM_NAME) as Platform[]

export interface AddChannelProps {
  onClose: () => void
}

export function AddChannel({ onClose }: AddChannelProps): React.ReactElement {
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<Platform>('twitch')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  const submit = async (): Promise<void> => {
    setError(null)
    const parsed = parseChannelInput(input, platform)

    if (!parsed.ok || !parsed.ref) {
      setError(parsed.error ?? 'Could not understand that channel.')
      return
    }

    const ref = parsed.ref
    setBusy(true)
    try {
      await bridge().api.addSource({
        platform: ref.platform,
        label: ref.label,
        identifier: ref.value
      })
      setInput('')
      onClose()
    } catch (err) {
      setError(remoteMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-10 flex justify-center"
      style={{ background: 'rgba(0,0,0,.5)' }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Add a channel"
        className="h-fit w-[420px] px-[20px] pt-[18px] pb-[20px]"
        style={{
          marginTop: 180,
          background: 'var(--ink-700)',
          border: '1px solid var(--line-2)',
          borderRadius: 10,
          boxShadow: '0 20px 48px rgba(0,0,0,.6)'
        }}
      >
        <h2 className="m-0 text-[16px] font-semibold" style={{ color: 'var(--heading)' }}>
          Add a channel
        </h2>

        <div className="mt-[14px] flex">
          <div
            className="relative flex h-[32px] w-[118px] flex-none items-center gap-[7px] px-[10px]"
            style={{
              background: 'var(--ink-800)',
              border: '1px solid var(--line-2)',
              borderRight: 0,
              borderRadius: '6px 0 0 6px'
            }}
          >
            <span
              aria-hidden
              className="h-[6px] w-[6px] flex-none rounded-full"
              style={{ background: PLATFORM_COLOR[platform] }}
            />
            <span className="flex-1 text-[14px]" style={{ color: 'var(--fg)' }}>
              {PLATFORM_NAME[platform]}
            </span>
            <ChevronDown size={13} strokeWidth={1.8} style={{ color: 'var(--fg-3)' }} />

            <select
              aria-label="Platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {PLATFORMS.map((value) => (
                <option key={value} value={value}>
                  {PLATFORM_NAME[value]}
                </option>
              ))}
            </select>
          </div>

          <input
            ref={field}
            value={input}
            spellCheck={false}
            placeholder="channel name, or paste a link"
            onChange={(event) => {
              setInput(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
            className="h-[32px] min-w-0 flex-1 px-[10px] text-[14px] outline-none"
            style={{
              background: 'var(--ink-800)',
              border: '1px solid var(--line-2)',
              borderRadius: '0 6px 6px 0',
              color: 'var(--fg)'
            }}
          />
        </div>

        <p className="mt-[10px] mb-0 text-[13px]" style={{ color: 'var(--fg-3)' }}>
          {error ?? (
            <>Paste a twitch.tv, youtube.com or kick.com link, or pick a platform and type a name.</>
          )}
        </p>

        <div className="mt-[16px] flex justify-end gap-[8px]">
          <button type="button" className="ghost-button h-[30px] px-[14px] text-[14px]" onClick={onClose}>
            Cancel
          </button>

          <button
            type="button"
            className="primary-button h-[30px] px-[14px] text-[14px]"
            disabled={input.trim() === '' || busy}
            onClick={() => void submit()}
          >
            Add channel
          </button>
        </div>
      </div>
    </div>
  )
}
