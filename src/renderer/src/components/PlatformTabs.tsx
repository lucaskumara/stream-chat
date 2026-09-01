import { memo } from 'react'
import { Columns2, Columns3, Square } from 'lucide-react'
import { PLATFORMS, type Platform, type SourceState } from '@shared/types'
import { PLATFORM_COLOR, PLATFORM_NAME } from '../theme'
import { PlatformMark } from './PlatformMark'

function PlatformTab({
  platform,
  on,
  live,
  onToggle
}: {
  platform: Platform
  on: boolean
  live: boolean
  onToggle: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      data-platform={platform}
      onClick={onToggle}
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
}

export interface PlatformTabsProps {
  visible: Platform[]
  sources: SourceState[]
  merged: boolean
  onToggle: (platform: Platform) => void
  onToggleMerged: () => void
}

function PlatformTabsImpl({
  visible,
  sources,
  merged,
  onToggle,
  onToggleMerged
}: PlatformTabsProps): React.ReactElement {
  const LayoutIcon = merged ? Square : visible.length > 2 ? Columns3 : Columns2

  return (
    <div className="no-drag flex flex-none items-center gap-[6px]">
      <div
        role="tablist"
        aria-label="Platform"
        aria-multiselectable
        className="flex flex-none gap-[2px] rounded-[7px] p-[2px]"
        style={{ background: 'var(--ink-800)', border: '1px solid var(--line-2)' }}
      >
        {PLATFORMS.map((platform) => {
          const source = sources.find((held) => held.platform === platform)

          return (
            <PlatformTab
              key={platform}
              platform={platform}
              on={visible.includes(platform)}
              live={source !== undefined && source.status !== 'error' && source.status !== 'offline'}
              onToggle={() => onToggle(platform)}
            />
          )
        })}
      </div>

      {/* Shows the layout you are in rather than the one a click would give — with one
          icon and two meanings, a control that reads as state is the legible half. It
          still only ever toggles merged/split; the column count picks which split icon
          to draw, and in split mode that count is exactly the visible tabs. */}
      <button
        type="button"
        className="icon-button layout-toggle"
        aria-label={merged ? 'Split the chats into columns' : 'Merge the chats into one column'}
        aria-pressed={merged}
        disabled={visible.length < 2}
        onClick={onToggleMerged}
      >
        <LayoutIcon size={15} strokeWidth={1.8} />
      </button>
    </div>
  )
}

export const PlatformTabs = memo(PlatformTabsImpl)
