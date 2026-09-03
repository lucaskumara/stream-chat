import type { SettingsPane } from '../../store'
import { useStore } from '../../store'
import { Platforms } from './Platforms'
import { Appearance } from './Appearance'
import { General } from './General'

const PANES: { pane: SettingsPane; label: string }[] = [
  { pane: 'general', label: 'General' },
  { pane: 'appearance', label: 'Appearance' },
  { pane: 'platforms', label: 'Platforms' }
]

const TITLES: Record<SettingsPane, { title: string; blurb: string }> = {
  general: { title: 'General', blurb: 'How the app starts.' },
  appearance: {
    title: 'Appearance',
    blurb: 'The theme, and how every chat looks and reads.'
  },
  platforms: {
    title: 'Platforms',
    blurb: 'Which chat to open, and where to forward your stream.'
  }
}

export function Settings(): React.ReactElement {
  const pane = useStore((s) => s.settingsPane)
  const setPane = useStore((s) => s.setSettingsPane)

  const { title, blurb } = TITLES[pane]

  return (
    <div className="flex min-h-0 flex-1" style={{ background: 'var(--ink-900)' }}>
      <nav
        className="flex w-[196px] flex-none flex-col gap-[2px] px-[10px] py-[14px]"
        style={{ borderRight: '1px solid var(--line)' }}
      >
        <div className="section-label px-[8px] pb-[8px]">Settings</div>

        {PANES.map((item) => {
          const on = item.pane === pane

          return (
            <button
              key={item.pane}
              type="button"
              aria-current={on}
              onClick={() => setPane(item.pane)}
              className="hoverable flex h-[30px] cursor-pointer items-center border-0 px-[10px] text-left text-[14px]"
              style={{
                borderRadius: 6,
                background: on ? 'var(--ink-700)' : 'transparent',
                color: on ? 'var(--heading)' : 'var(--fg-2)'
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.background = 'var(--hover-row)'
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.background = 'transparent'
              }}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto px-[28px] py-[22px] chat-scroll">
        <div className="max-w-[560px]">
          <h1 className="m-0 text-[17px] font-semibold" style={{ color: 'var(--heading)' }}>
            {title}
          </h1>
          <p className="mt-[4px] mb-[20px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
            {blurb}
          </p>

          {pane === 'general' && <General />}
          {pane === 'appearance' && <Appearance />}
          {pane === 'platforms' && <Platforms />}
        </div>
      </div>
    </div>
  )
}
