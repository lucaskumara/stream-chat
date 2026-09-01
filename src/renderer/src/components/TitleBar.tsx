import { useEffect, useState } from 'react'
import type { SourceState } from '@shared/types'
import { bridge } from '../bridge'
import type { View } from '../store'
import { ChannelTabs } from './ChannelTabs'
import { ModeSwitcher } from './ModeSwitcher'

function Glyph({ path }: { path: string }): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

const MINIMIZE = 'M0 5.5 H10'
const MAXIMIZE = 'M0.5 0.5 H9.5 V9.5 H0.5 Z'
const RESTORE = 'M2.5 2.5 H9.5 V9.5 H2.5 Z M0.5 0.5 H7.5 V2.5 M0.5 0.5 V7.5 H2.5'
const CLOSE = 'M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5'

export interface TitleBarProps {
  view: View
  onView: (view: View) => void
  sources: SourceState[]
  visibleIds: string[]
  onSelect: (sourceId: string) => void
  onSplit: (sourceId: string) => void
  onRemove: (source: SourceState) => void
  onAdd: () => void
}

export function TitleBar({
  view,
  onView,
  sources,
  visibleIds,
  onSelect,
  onSplit,
  onRemove,
  onAdd
}: TitleBarProps): React.ReactElement {
  const [maximized, setMaximized] = useState(false)

  const { api } = bridge()
  const trafficLights = api.platform === 'darwin'

  useEffect(() => {
    const { api } = bridge()

    void api.windowIsMaximized().then(setMaximized)

    return api.onWindowMaximized(setMaximized)
  }, [])

  // Without tabs beside it the divider is just a stray line in the bar
  const tabs = view === 'chats' && sources.length > 0

  return (
    <div className="titlebar">
      <ModeSwitcher view={view} onSelect={onView} />

      {tabs && (
        <>
          <span aria-hidden className="h-[20px] w-px flex-none" style={{ background: 'var(--line)' }} />

          <ChannelTabs
            sources={sources}
            visibleIds={visibleIds}
            onSelect={onSelect}
            onSplit={onSplit}
            onRemove={onRemove}
            onAdd={onAdd}
          />
        </>
      )}

      <div className="titlebar-drag" />

      {!trafficLights && (
        <>
          <button
            type="button"
            className="titlebar-button"
            aria-label="Minimize"
            onClick={() => void api.windowMinimize()}
          >
            <Glyph path={MINIMIZE} />
          </button>

          <button
            type="button"
            className="titlebar-button"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => void api.windowToggleMaximize()}
          >
            <Glyph path={maximized ? RESTORE : MAXIMIZE} />
          </button>

          <button
            type="button"
            className="titlebar-button titlebar-close"
            aria-label="Close"
            onClick={() => void api.windowClose()}
          >
            <Glyph path={CLOSE} />
          </button>
        </>
      )}
    </div>
  )
}
