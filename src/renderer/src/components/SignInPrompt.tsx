import type { AccountState, Platform } from '@shared/types'
import { bridge } from '../bridge'
import { PlatformMark } from './PlatformMark'
import { PLATFORM_COLOR } from '../theme'
import { useStore } from '../store'

const NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

export interface SignInPromptProps {
  platform: Platform
}

/** What a platform's column shows before an account is connected. There is no channel
    field any more: the app opens the chat belonging to whoever signs in, so the sign-in
    *is* the channel picker. */
export function SignInPrompt({ platform }: SignInPromptProps): React.ReactElement {
  const account = useStore((s) => s.accounts.find((a) => a.platform === platform))

  const name = NAME[platform]

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-[20px]">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-[8px]">
          <span style={{ color: PLATFORM_COLOR[platform] }}>
            <PlatformMark platform={platform} height={16} />
          </span>
          <h2 className="m-0 text-[17px] font-semibold" style={{ color: 'var(--heading)' }}>
            {name}
          </h2>
        </div>

        <p className="mt-[6px] mb-[14px] text-[14px]" style={{ color: 'var(--fg-3)' }}>
          {blurb(account, name)}
        </p>

        {account?.status !== 'not-configured' && (
          <button
            type="button"
            disabled={account?.status === 'pending'}
            onClick={() => void bridge().api.accountSignIn(platform)}
            className="primary-button h-[34px] px-[16px] text-[14px]"
          >
            {account?.status === 'pending' ? 'Waiting…' : `Sign in to ${name}`}
          </button>
        )}

        {account?.status === 'error' && account.error && (
          <div className="mt-[10px] text-[13px]" style={{ color: 'var(--error)' }}>
            {account.error}
          </div>
        )}
      </div>
    </div>
  )
}

function blurb(account: AccountState | undefined, name: string): string {
  if (account?.status === 'not-configured') {
    return `This build carries no ${name} client credentials, so it cannot sign in yet.`
  }

  if (account?.status === 'pending' && account.prompt) {
    return `Approve in your browser — the code ${account.prompt.userCode} is already filled in.`
  }

  if (account?.status === 'pending') return 'Waiting for your browser…'

  return `Sign in and your own ${name} chat opens here.`
}
