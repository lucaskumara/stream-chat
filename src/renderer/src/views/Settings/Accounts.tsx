import type { Platform } from '@shared/types'
import { bridge } from '../../bridge'
import { PLATFORM_COLOR } from '../../theme'
import { useStore } from '../../store'

interface Row {
  platform: Platform
  name: string
  detail: string
  connected: boolean
  onAction?: () => void
}

export function Accounts(): React.ReactElement {
  const auth = useStore((s) => s.twitchAuth)

  const twitchConnected = auth.status === 'signed-in'

  const rows: Row[] = [
    {
      platform: 'twitch',
      name: 'Twitch',
      detail: twitchConnected
        ? `${auth.login ?? 'signed in'} · full access`
        : 'Not connected',
      connected: twitchConnected,
      onAction: () => {
        const { api } = bridge()
        void (twitchConnected ? api.twitchSignOut() : api.twitchStartLogin())
      }
    },
    { platform: 'youtube', name: 'YouTube', detail: 'Read only', connected: false },
    { platform: 'kick', name: 'Kick', detail: 'Read only', connected: false }
  ]

  return (
    <div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 9 }}>
        {rows.map((row, at) => (
          <div
            key={row.platform}
            className="flex items-center gap-[12px] px-[14px] py-[12px]"
            style={{ borderTop: at === 0 ? undefined : '1px solid var(--line)' }}
          >
            <span
              aria-hidden
              className="h-[8px] w-[8px] flex-none rounded-full"
              style={{
                background: PLATFORM_COLOR[row.platform],
                opacity: row.connected ? 1 : 0.4
              }}
            />

            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px]" style={{ color: '#ededed' }}>
                {row.name}
              </div>
              <div className="truncate text-[13px]" style={{ color: 'var(--fg-4)' }}>
                {row.detail}
              </div>
            </div>

            {row.onAction && (
              <button
                type="button"
                className="ghost-button h-[26px] flex-none px-[12px] text-[13px]"
                onClick={row.onAction}
              >
                {row.connected ? 'Sign out' : 'Sign in'}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="mt-[10px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
        Signing in lets you send messages and moderate. Read-only chats work without an
        account.
      </p>
    </div>
  )
}
