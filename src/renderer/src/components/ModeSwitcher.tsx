import { memo } from 'react'
import { MessageSquare, Radio, Settings } from 'lucide-react'
import type { View } from '../store'

const MODES: { id: View | 'settings'; label: string; Icon: typeof MessageSquare }[] = [
  { id: 'chats', label: 'Chat', Icon: MessageSquare },
  { id: 'broadcast', label: 'Broadcast', Icon: Radio },
  { id: 'settings', label: 'Settings', Icon: Settings }
]

export interface ModeSwitcherProps {
  view: View
  settingsOpen: boolean
  onSelectView: (view: View) => void
  onOpenSettings: () => void
}

/** Settings is not a third view — it opens as a modal over whichever of the other
    two is underneath — so its button toggles `settingsOpen` rather than joining
    the chats/broadcast exclusion. It still sits in the same segmented group,
    since that is where the handoff put it. */
function ModeSwitcherImpl({
  view,
  settingsOpen,
  onSelectView,
  onOpenSettings
}: ModeSwitcherProps): React.ReactElement {
  return (
    <div
      role="tablist"
      aria-label="View"
      className="no-drag flex flex-none gap-[2px] rounded-[7px] p-[2px]"
      style={{ background: 'var(--ink-800)', border: '1px solid var(--line-2)' }}
    >
      {MODES.map(({ id, label, Icon }) => {
        const on = id === 'settings' ? settingsOpen : view === id

        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => (id === 'settings' ? onOpenSettings() : onSelectView(id))}
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
