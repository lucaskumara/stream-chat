import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/** A hover tooltip rendered through a portal to `document.body`, so it always
    paints above everything else in the window. A plain absolutely-positioned
    span inside a message row cannot promise that: `ChatPane`'s virtualizer gives
    every row wrapper its own `transform`, which — like `position` + non-auto
    `z-index` — creates a stacking context, and a z-index set *inside* one caps
    out at the top of that context. It can beat other content in the same row,
    but never a later, unrelated sibling like the Settings modal's backdrop,
    which sits in its own context nearer the document root. Confirmed live:
    hovering a badge with Settings open put the tooltip visibly behind the
    backdrop before this, `elementFromPoint` landing on the modal every time. */
export function HoverPopup({
  children,
  popup
}: {
  children: React.ReactNode
  popup: React.ReactNode
}): React.ReactElement {
  const [node, setNode] = useState<HTMLSpanElement | null>(null)
  const [hovered, setHovered] = useState(false)

  // A portaled tooltip no longer scrolls with the row it's anchored to, so a
  // stale position would drift the moment the chat scrolls under it — closing
  // on any scroll is simpler and more honest than tracking position live.
  // Scroll doesn't bubble, but it is seen by a capturing listener regardless.
  useEffect(() => {
    if (!hovered) return

    const close = (): void => setHovered(false)
    window.addEventListener('scroll', close, true)

    return () => window.removeEventListener('scroll', close, true)
  }, [hovered])

  return (
    <span
      ref={setNode}
      className="relative inline-block align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}

      {hovered && node && createPortal(<TooltipBody anchor={node}>{popup}</TooltipBody>, document.body)}
    </span>
  )
}

function TooltipBody({
  anchor,
  children
}: {
  anchor: HTMLElement
  children: React.ReactNode
}): React.ReactElement {
  const rect = anchor.getBoundingClientRect()

  return (
    <span
      role="tooltip"
      className="pointer-events-none fixed -translate-x-1/2 text-[13px] whitespace-nowrap"
      style={{
        left: rect.left + rect.width / 2,
        bottom: window.innerHeight - rect.top + 5,
        zIndex: 9999,
        background: 'var(--ink-600)',
        border: '1px solid var(--line-2)',
        borderRadius: 6,
        padding: '.3em .55em',
        boxShadow: '0 8px 20px rgba(0,0,0,.5)'
      }}
    >
      {children}
    </span>
  )
}
