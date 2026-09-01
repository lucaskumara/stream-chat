import type { AccountState, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { bridge } from '../../bridge'
import { PlatformMark } from '../../components/PlatformMark'
import { PLATFORM_COLOR } from '../../theme'
import { useStore } from '../../store'

const NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

/** How each platform asks for credentials, said plainly — the two are genuinely
    different experiences and a user who expects a window should get one. */
const METHOD: Record<Platform, string> = {
  twitch: 'Opens twitch.tv in your browser',
  youtube: 'Opens a sign-in window',
  kick: 'Opens a sign-in window'
}

const EMPTY: AccountState = { platform: 'twitch', status: 'signed-out' }

export function Accounts(): React.ReactElement {
  const accounts = useStore((s) => s.accounts)

  const byPlatform = (platform: Platform): AccountState =>
    accounts.find((account) => account.platform === platform) ?? { ...EMPTY, platform }

  return (
    <div>
      <div style={{ border: '1px solid var(--line)', borderRadius: 9 }}>
        {PLATFORMS.map((platform, at) => (
          <Row key={platform} account={byPlatform(platform)} first={at === 0} />
        ))}
      </div>

      <p className="mt-[10px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
        Reading chat never needs an account. Signing in is what will later let you send
        messages, moderate, and read your own stream keys.
      </p>
    </div>
  )
}

function Row({
  account,
  first
}: {
  account: AccountState
  first: boolean
}): React.ReactElement {
  const { platform, status } = account

  const busy = status === 'pending'
  const on = status === 'signed-in'

  const act = (): void => {
    const { api } = bridge()

    void (on ? api.accountSignOut(platform) : api.accountSignIn(platform)).catch(
      (error) => console.debug('[accounts]', platform, error)
    )
  }

  return (
    <div
      className="flex items-center gap-[12px] px-[14px] py-[12px]"
      style={{ borderTop: first ? undefined : '1px solid var(--line)' }}
    >
      <span
        className="flex h-[20px] w-[20px] flex-none items-center justify-center"
        style={{ color: on ? PLATFORM_COLOR[platform] : 'var(--fg-4)' }}
      >
        <PlatformMark platform={platform} height={14} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px]" style={{ color: 'var(--heading)' }}>
          {NAME[platform]}
        </div>
        <Detail account={account} />
      </div>

      {status !== 'not-configured' && (
        <button
          type="button"
          disabled={busy}
          className="ghost-button h-[26px] flex-none px-[12px] text-[13px]"
          onClick={act}
        >
          {on ? 'Sign out' : busy ? 'Waiting…' : 'Sign in'}
        </button>
      )}
    </div>
  )
}

function Detail({ account }: { account: AccountState }): React.ReactElement {
  const tone = account.status === 'error' ? 'var(--error)' : 'var(--fg-4)'

  return (
    <div className="truncate text-[13px]" style={{ color: tone }}>
      {detailText(account)}
    </div>
  )
}

function detailText(account: AccountState): string {
  switch (account.status) {
    case 'not-configured':
      return 'This build has no Twitch Client ID compiled in'

    case 'error':
      return account.error ?? 'Sign-in failed'

    case 'pending':
      return account.prompt
        ? `Enter ${account.prompt.userCode} at ${hostOf(account.prompt.verificationUri)}`
        : 'Waiting for sign-in…'

    case 'signed-in': {
      const who = account.displayName ?? 'Signed in'
      const grants = account.grants?.join(', ')

      return grants ? `${who} · ${grants}` : who
    }

    default:
      return METHOD[account.platform]
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
