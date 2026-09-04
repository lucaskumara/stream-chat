import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import type { SettingsPane } from '../../store'
import { useStore } from '../../store'
import { Platforms, platformCardId } from './Platforms'
import { usePlatformDrafts } from './usePlatformDrafts'
import { Appearance } from './Appearance'
import { General } from './General'

const SCROLL_TARGET_TOP_GAP_PX = 16

const PANES: { pane: SettingsPane; label: string }[] = [
  { pane: 'general', label: 'General' },
  { pane: 'appearance', label: 'Appearance' },
  { pane: 'platforms', label: 'Platforms' }
]

const TITLES: Record<SettingsPane, { title: string; blurb: string }> = {
  general: { title: 'General', blurb: 'Logs and diagnostics.' },
  appearance: {
    title: 'Appearance',
    blurb: 'The theme, and how every chat looks and reads.'
  },
  platforms: {
    title: 'Platforms',
    blurb: 'Which chat to open, and where to forward your stream.'
  }
}

const SCROLL_TOP_THRESHOLD_PX = 200

export function Settings(): React.ReactElement {
  const pane = useStore((s) => s.settingsPane)
  const setPane = useStore((s) => s.setSettingsPane)
  const scrollTarget = useStore((s) => s.platformsScrollTarget)
  const clearScrollTarget = useStore((s) => s.clearPlatformsScrollTarget)

  // Called unconditionally rather than only on the Platforms pane, so Platforms
  // itself mounts already holding whatever was typed instead of starting blank.
  const platformDrafts = usePlatformDrafts()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)

  // Consuming a scroll target sets it back to null, which would otherwise also
  // re-run the pane-reset effect below and immediately undo the scroll it just
  // did — this ref is what tells that effect "skip it, this pass was already
  // handled" rather than the two fighting over the same scroll position.
  const consumedScrollTarget = useRef(false)

  const { title, blurb } = TITLES[pane]

  // Opening Settings from a platform-specific prompt (a NotConfigured column,
  // Broadcast's "Add a stream key") should jump straight to that card rather
  // than leaving the user to find it among the other two. Scrolled manually
  // rather than via scrollIntoView, which lands the card flush against the
  // container's edge with no breathing room above it.
  useEffect(() => {
    if (!scrollTarget) return

    const container = scrollRef.current
    const card = document.getElementById(platformCardId(scrollTarget))

    if (container && card) {
      container.scrollTop = Math.max(0, card.offsetTop - SCROLL_TARGET_TOP_GAP_PX)
    }

    consumedScrollTarget.current = true
    clearScrollTarget()
  }, [scrollTarget, clearScrollTarget])

  // A pane switch swaps content inside the same scrolling box, so without this a
  // long pane (Platforms) left scrolled down leaves a short one (General) opening
  // stuck mid-scroll, showing nothing. Declared after the effect above so a
  // scroll-to-target's own pane switch runs first within the same commit.
  useEffect(() => {
    if (consumedScrollTarget.current) {
      consumedScrollTarget.current = false
      return
    }

    scrollRef.current?.scrollTo({ top: 0 })
    setShowScrollTop(false)
  }, [pane])

  const handleScroll = (): void => {
    setShowScrollTop((scrollRef.current?.scrollTop ?? 0) > SCROLL_TOP_THRESHOLD_PX)
  }

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

      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // Top is 44px rather than 0 — padding alone doesn't move it, since the
          // scrollbar track rides this box's own top edge regardless of interior
          // padding, and it was landing directly under the close button, which
          // floats over this column at top:10.
          className="chat-scroll absolute inset-x-0 bottom-0 overflow-y-auto px-[28px] py-[22px]"
          style={{ top: 44 }}
        >
          <div className="max-w-[560px]">
            <h1 className="m-0 text-[17px] font-semibold" style={{ color: 'var(--heading)' }}>
              {title}
            </h1>
            <p className="mt-[4px] mb-[20px] text-[13px]" style={{ color: 'var(--fg-4)' }}>
              {blurb}
            </p>

            {pane === 'general' && <General />}
            {pane === 'appearance' && <Appearance />}
            {pane === 'platforms' && <Platforms {...platformDrafts} />}
          </div>
        </div>

        {showScrollTop && (
          <button
            type="button"
            aria-label="Scroll to top"
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="icon-button absolute flex items-center justify-center"
            style={{
              bottom: 16,
              right: 16,
              width: 32,
              height: 32,
              borderRadius: 999,
              background: 'var(--ink-700)',
              border: '1px solid var(--line-2)',
              boxShadow: '0 6px 18px var(--shadow)'
            }}
          >
            <ArrowUp size={16} strokeWidth={1.8} />
          </button>
        )}

        {/* Floats over the scrollable content rather than reserving space in it —
            the fixed footer this replaced took up room on every visit even when
            nothing was dirty. Only shown on Platforms, where the fields it's
            about actually live. */}
        {pane === 'platforms' && platformDrafts.dirty && (
          <div
            className="absolute flex items-center gap-[12px] px-[14px] py-[10px]"
            style={{
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'var(--ink-700)',
              border: '1px solid var(--line-2)',
              borderRadius: 8,
              boxShadow: '0 8px 24px var(--shadow)'
            }}
          >
            <span className="text-[13px] whitespace-nowrap" style={{ color: 'var(--heading)' }}>
              You have unsaved changes
            </span>

            <button
              type="button"
              className="primary-button h-[26px] flex-none px-[12px] text-[12px]"
              disabled={platformDrafts.saving}
              onClick={() => void platformDrafts.save()}
            >
              {platformDrafts.saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
