import { useState } from 'react'
import type { Platform } from '@shared/types'
import { bridge, remoteMessage } from '../bridge'
import { parseForPlatform } from '../connect'
import { useStore } from '../store'
import { ChatLink } from './ChatLink'
import { ControlRow, Stepper, Toggle } from './controls'

function Rule(): React.ReactElement {
  return <div className="my-[12px] h-px" style={{ background: 'var(--line)' }} />
}

function Group({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div>
      <div className="section-label mb-[8px]">{label}</div>
      {children}
    </div>
  )
}

export interface ChatSettingsProps {
  /** null while the pane holds several merged chats: a dock addresses one channel,
      and "disconnect" would have to guess which. */
  sourceId: string | null

  /** Null on a merged pane, which has no single platform to point elsewhere. */
  platform: Platform | null
  fontSize: number
  onFontStep: (steps: number) => void
  onFontReset: () => void
  onClear: () => void
  onDisconnect: () => void
}

export function ChatSettings({
  sourceId,
  platform,
  fontSize,
  onFontStep,
  onFontReset,
  onClear,
  onDisconnect
}: ChatSettingsProps): React.ReactElement {
  const showTimestamps = useStore((s) => s.showTimestamps)
  const showDeleted = useStore((s) => s.showDeleted)
  const setShowTimestamps = useStore((s) => s.setShowTimestamps)
  const setShowDeleted = useStore((s) => s.setShowDeleted)

  return (
    <div
      className="absolute z-[5] w-[340px] px-[16px] pt-[14px] pb-[16px]"
      style={{
        top: 48,
        right: 10,
        background: 'var(--ink-600)',
        border: '1px solid var(--line-2)',
        borderRadius: 10,
        boxShadow: '0 14px 36px rgba(0,0,0,.55)'
      }}
    >
      <Group label="Every chat">
        <ControlRow label="Timestamps">
          <Toggle label="Timestamps" on={showTimestamps} onChange={setShowTimestamps} />
        </ControlRow>

        <ControlRow label="Deleted messages">
          <Toggle label="Deleted messages" on={showDeleted} onChange={setShowDeleted} />
        </ControlRow>
      </Group>

      <Rule />

      <Group label="This chat">
        <ControlRow label="Text size">
          <Stepper label="chat text" size={fontSize} onStep={onFontStep} />
        </ControlRow>

        <div className="mt-[8px] flex gap-[8px]">
          <button
            type="button"
            className="ghost-button chat-pane-font-reset h-[28px] flex-1 text-[13px]"
            onClick={onFontReset}
          >
            Reset size
          </button>

          <button
            type="button"
            className="ghost-button chat-pane-clear h-[28px] flex-1 text-[13px]"
            onClick={onClear}
          >
            Clear chat
          </button>
        </div>
      </Group>

      {platform !== null && (
        <>
          <Rule />

          <Group label="Watch another channel">
            <WatchAnother platform={platform} />
          </Group>
        </>
      )}

      {sourceId !== null && (
        <>
          <Rule />

          <Group label="OBS dock link">
            <ChatLink sourceId={sourceId} />
          </Group>

          <Rule />

          <button
            type="button"
            className="ghost-button chat-pane-disconnect h-[28px] w-full text-[13px]"
            onClick={onDisconnect}
          >
            Sign out
          </button>
        </>
      )}
    </div>
  )
}

/** Signing in picks the channel, so this is the way out of that for testing: any channel
    can be read, and typed into, because Twitch takes the target as `broadcaster_id` and
    the sender from the token. Clearing it goes back to the account's own chat. */
function WatchAnother({ platform }: { platform: Platform }): React.ReactElement {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const watch = async (identifier: string | null): Promise<void> => {
    setError(null)

    if (identifier !== null) {
      const parsed = parseForPlatform(identifier, platform)

      if (!parsed.ok || !parsed.ref) {
        setError(parsed.error ?? 'That is not a channel name.')
        return
      }

      identifier = parsed.ref.value
    }

    try {
      await bridge().api.watchChannel(platform, identifier)
      setDraft('')
    } catch (err) {
      setError(remoteMessage(err))
    }
  }

  return (
    <div>
      <div className="flex gap-[8px]">
        <input
          type="text"
          value={draft}
          placeholder="Channel name"
          aria-label="Channel to watch"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void watch(draft)
          }}
          className="inset-field min-w-0 flex-1 px-[10px] text-[13px]"
          style={{ height: 28 }}
        />

        <button
          type="button"
          disabled={!draft.trim()}
          className="ghost-button h-[28px] flex-none px-[12px] text-[13px]"
          onClick={() => void watch(draft)}
        >
          Watch
        </button>
      </div>

      <button
        type="button"
        className="ghost-button mt-[8px] h-[28px] w-full text-[13px]"
        onClick={() => void watch(null)}
      >
        Back to my channel
      </button>

      {error && (
        <div className="mt-[8px] text-[13px]" style={{ color: 'var(--error)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
