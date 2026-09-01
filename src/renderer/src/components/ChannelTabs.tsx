import { memo, useState } from 'react'
import { Columns2, Plus, X } from 'lucide-react'
import type { SourceState } from '@shared/types'
import { PLATFORM_COLOR } from '../theme'

function TabAction({
  label,
  visible,
  lit,
  onClick,
  children
}: {
  label: string
  visible: boolean
  lit?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactElement {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex h-[18px] w-[18px] flex-none cursor-pointer items-center justify-center border-0 p-0"
      style={{
        borderRadius: 4,
        background: hover ? '#303030' : 'transparent',
        color: hover ? '#e0e0e0' : lit ? '#b4b4b4' : 'var(--fg-4)',
        opacity: visible || lit ? 1 : 0
      }}
    >
      {children}
    </button>
  )
}

function ChannelTabImpl({
  source,
  shown,
  splittable,
  onSelect,
  onSplit,
  onRemove
}: {
  source: SourceState
  shown: boolean
  splittable: boolean
  onSelect: () => void
  onSplit: () => void
  onRemove: () => void
}): React.ReactElement {
  const [hover, setHover] = useState(false)

  const offline = source.status === 'offline' || source.status === 'error'

  return (
    <div
      role="tab"
      aria-selected={shown}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect()
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="no-drag flex h-[28px] flex-none cursor-pointer items-center gap-[8px] pr-[6px] pl-[10px] text-[14px]"
      style={{
        borderRadius: 6,
        border: `1px solid ${shown ? 'var(--line-2)' : 'transparent'}`,
        background: shown ? 'var(--ink-700)' : hover ? 'var(--hover-row)' : 'transparent',
        color: shown ? '#f0f0f0' : hover ? '#e0e0e0' : 'var(--fg-2)'
      }}
    >
      <span
        aria-hidden
        className="h-[6px] w-[6px] flex-none rounded-full"
        style={{
          background: offline ? 'var(--offline-dot)' : PLATFORM_COLOR[source.platform],
          opacity: shown ? 1 : 0.55
        }}
      />

      <span className="max-w-[160px] truncate">{source.label}</span>

      <TabAction
        label={`Show ${source.label} alongside`}
        visible={hover}
        lit={shown && splittable}
        onClick={onSplit}
      >
        <Columns2 size={13} strokeWidth={1.8} />
      </TabAction>

      <TabAction label={`Remove ${source.label}`} visible={hover} onClick={onRemove}>
        <X size={13} strokeWidth={1.8} />
      </TabAction>
    </div>
  )
}

const ChannelTab = memo(ChannelTabImpl)

export interface ChannelTabsProps {
  sources: SourceState[]
  visibleIds: string[]
  onSelect: (sourceId: string) => void
  onSplit: (sourceId: string) => void
  onRemove: (source: SourceState) => void
  onAdd: () => void
}

function ChannelTabsImpl({
  sources,
  visibleIds,
  onSelect,
  onSplit,
  onRemove,
  onAdd
}: ChannelTabsProps): React.ReactElement {
  return (
    <div role="tablist" aria-label="Channels" className="flex min-w-0 flex-none items-center gap-[3px]">
      {sources.map((source) => (
        <ChannelTab
          key={source.id}
          source={source}
          shown={visibleIds.includes(source.id)}
          splittable={visibleIds.length > 1}
          onSelect={() => onSelect(source.id)}
          onSplit={() => onSplit(source.id)}
          onRemove={() => onRemove(source)}
        />
      ))}

      <button
        type="button"
        aria-label="Add a channel"
        onClick={onAdd}
        className="icon-button no-drag"
      >
        <Plus size={15} strokeWidth={1.8} />
      </button>
    </div>
  )
}

export const ChannelTabs = memo(ChannelTabsImpl)
