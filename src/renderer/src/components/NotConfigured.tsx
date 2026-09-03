import type { Platform } from '@shared/types'
import { PlatformMark } from './PlatformMark'
import { PLATFORM_COLOR } from '../theme'
import { useStore } from '../store'

const NAME: Record<Platform, string> = {
  twitch: 'Twitch',
  youtube: 'YouTube',
  kick: 'Kick'
}

export interface NotConfiguredProps {
  platform: Platform
}

/** What a platform's column shows before a channel is set. There is no field here: the
    settings screen is the one place a platform is configured, so this points at it
    rather than growing a second way in. */
export function NotConfigured({ platform }: NotConfiguredProps): React.ReactElement {
  const openSettings = useStore((s) => s.openSettings)
  const setPane = useStore((s) => s.setSettingsPane)

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
          Set a {name} channel and its chat opens here. No account needed.
        </p>

        <button
          type="button"
          className="primary-button h-[34px] px-[16px] text-[14px]"
          onClick={() => {
            setPane('platforms')
            openSettings()
          }}
        >
          Open settings
        </button>
      </div>
    </div>
  )
}
