import { memo } from 'react'
import { MessageSquare, Radio, Settings } from 'lucide-react'
import type { View } from '../store'

const MODES: { view: View; label: string; Icon: typeof MessageSquare }[] = [
  { view: 'chats', label: 'Chat', Icon: MessageSquare },
  { view: 'broadcast', label: 'Broadcast', Icon: Radio },
  { view: 'settings', label: 'Settings', Icon: Settings }
]

export interface ModeSwitcherProps {
  view: View
  onSelect: (view: View) => void
}

function ModeSwitcherImpl({ view, onSelect }: ModeSwitcherProps): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="View"
      className="no-drag flex flex-none gap-[2px] rounded-[7px] p-[2px]"
      style={{ background: 'var(--ink-800)', border: '1px solid var(--line-2)' }}
    >
      {MODES.map(({ view: mode, label, Icon }) => {
        const on = view === mode

        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(mode)}
            className="flex h-[26px] cursor-pointer items-center gap-[7px] rounded-[5px] border-0 px-[11px] text-[14px]"
            style={{
              background: on ? 'var(--segment-on)' : 'transparent',
              color: on ? 'var(--heading)' : 'var(--fg-3)'
            }}
            onMouseEnter={(e) => {
              if (!on) e.currentTarget.style.color = 'var(--fg)'
            }}
            onMouseLeave={(e) => {
              if (!on) e.currentTarget.style.color = 'var(--fg-3)'
            }}
          >
            <Icon size={15} strokeWidth={1.8} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

export const ModeSwitcher = memo(ModeSwitcherImpl)
