import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { Settings } from '../views/Settings'

/** Settings renders as a modal over whichever view is underneath, dimmed through
    `--overlay`, rather than replacing it — the chats or broadcast pane stays
    mounted (and visible) behind the backdrop, so closing the modal costs nothing
    to redraw. */
export function SettingsModal(): React.ReactElement {
  const close = useStore((s) => s.closeSettings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'var(--overlay)' }}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative flex min-h-0 flex-col"
        style={{
          width: 'min(860px, 92vw)',
          height: 'min(640px, 85vh)',
          background: 'var(--ink-900)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: '0 24px 60px var(--shadow)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="icon-button absolute"
          // Settings' own scroll container is also absolutely positioned and
          // declared later in the tree (nested inside <Settings/>, which renders
          // after this button) — with both at the default z-index:auto, paint
          // order falls back to tree order and the scroll container covered this
          // button entirely. An explicit z-index takes it out of that ordering.
          style={{ top: 10, right: 10, zIndex: 1 }}
          aria-label="Close settings"
          onClick={close}
        >
          <X size={16} strokeWidth={1.8} />
        </button>

        <Settings />
      </div>
    </div>
  )
}
