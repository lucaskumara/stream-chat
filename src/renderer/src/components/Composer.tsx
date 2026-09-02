import { useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import type { AccountState, Platform } from '@shared/types'
import { bridge, remoteMessage } from '../bridge'

/** Which platforms this build can send on at all. Kick and YouTube come next; until they
    do, their panes get no composer rather than a box that only ever refuses. */
export const CAN_SEND: readonly Platform[] = ['twitch']

const MAX_LENGTH = 500

/** Left of the count, where the count would otherwise sit — the two never both apply. */
const COUNTDOWN_FROM = 60

export interface ComposerProps {
  sourceId: string
  platform: Platform
  label: string
  account: AccountState | undefined
  fontSize: number
}

export function Composer({
  sourceId,
  platform,
  label,
  account,
  fontSize
}: ComposerProps): React.ReactElement | null {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!CAN_SEND.includes(platform)) return null

  const blocked = blockedReason(account)

  const send = async (): Promise<void> => {
    const body = text.trim()
    if (!body || busy || blocked) return

    setBusy(true)
    setError(null)

    try {
      await bridge().api.sendMessage(sourceId, body)
      setText('')
    } catch (err) {
      setError(remoteMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remaining = MAX_LENGTH - text.length

  return (
    <div
      className="flex-none px-[10px] pb-[10px] pt-[8px]"
      style={{ borderTop: '1px solid var(--line)' }}
    >
      <div
        className="flex items-end gap-[8px] px-[10px] py-[7px]"
        style={{
          background: 'var(--ink-800)',
          border: '1px solid var(--line-2)',
          borderRadius: 8
        }}
      >
        <textarea
          rows={1}
          value={text}
          disabled={!!blocked || busy}
          maxLength={MAX_LENGTH}
          placeholder={blocked ?? `Send a message to ${label}`}
          aria-label={blocked ?? `Send a message to ${label}`}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is the escape hatch, matching every chat client.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent outline-none"
          style={{
            color: 'var(--fg)',
            fontSize,
            lineHeight: '1.35',
            maxHeight: 96,
            fontFamily: 'inherit'
          }}
        />

        {!blocked && remaining <= COUNTDOWN_FROM && (
          <span className="flex-none text-[12px] tabular-nums" style={{ color: 'var(--fg-4)' }}>
            {remaining}
          </span>
        )}

        <button
          type="button"
          disabled={!!blocked || busy || !text.trim()}
          onClick={() => void send()}
          aria-label="Send message"
          className="ghost-button flex h-[24px] w-[24px] flex-none items-center justify-center p-0"
        >
          <SendHorizontal size={14} strokeWidth={1.8} />
        </button>
      </div>

      {error && (
        <div className="mt-[6px] text-[12px]" style={{ color: 'var(--error)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

/** Null means the box is usable. Everything else is a reason phrased as the placeholder,
    so the input itself explains why it will not take a message. */
function blockedReason(account: AccountState | undefined): string | null {
  if (!account || account.status !== 'signed-in') return 'Sign in to Twitch to chat'

  if (!account.grants?.includes('send chat')) {
    return 'Sign in to Twitch again to allow sending'
  }

  return null
}
