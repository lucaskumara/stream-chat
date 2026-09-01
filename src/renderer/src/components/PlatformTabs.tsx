import { memo } from 'react'
import { PLATFORMS, type Platform, type SourceState } from '@shared/types'
import { PLATFORM_COLOR, PLATFORM_NAME } from '../theme'
import { PlatformMark } from './PlatformMark'

export interface PlatformTabsProps {
  active: Platform
  sources: SourceState[]
  onSelect: (platform: Platform) => void
}

function PlatformTabsImpl({ active, sources, onSelect }: PlatformTabsProps): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Platform"
      className="no-drag flex flex-none gap-[2px] rounded-[7px] p-[2px]"
      style={{ background: 'var(--ink-800)', border: '1px solid var(--line-2)' }}
    >
      {PLATFORMS.map((platform) => {
        const on = active === platform
        const source = sources.find((held) => held.platform === platform)
        const live = source !== undefined && source.status !== 'error' && source.status !== 'offline'

        return (
          <button
            key={platform}
            type="button"
            role="tab"
            aria-selected={on}
            data-platform={platform}
            onClick={() => onSelect(platform)}
            className="flex h-[26px] cursor-pointer items-center gap-[7px] rounded-[5px] border-0 px-[11px] text-[14px]"
            style={{
              background: on ? 'var(--segment-on)' : 'transparent',
              color: on ? '#f2f2f2' : 'var(--fg-3)'
            }}
            onMouseEnter={(e) => {
              if (!on) e.currentTarget.style.color = '#e0e0e0'
            }}
            onMouseLeave={(e) => {
              if (!on) e.currentTarget.style.color = 'var(--fg-3)'
            }}
          >
            <span style={{ color: live ? PLATFORM_COLOR[platform] : undefined }}>
              <PlatformMark platform={platform} />
            </span>

            {PLATFORM_NAME[platform]}
          </button>
        )
      })}
    </div>
  )
}

export const PlatformTabs = memo(PlatformTabsImpl)
