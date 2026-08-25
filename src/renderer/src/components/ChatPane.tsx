import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatMessage } from '@shared/types'
import type { RuleEngine } from '../rules'
import { bridge } from '../bridge'
import { MessageRow } from './MessageRow'

const PIN_THRESHOLD_PX = 40
const ESTIMATED_ROW_PX = 26

export interface ChatPaneProps {
  messages: ChatMessage[]
  engine: RuleEngine
  deleted: Record<string, true>
  showDeleted: boolean
  showTimestamps: boolean
  showPlatform: boolean
  search: string
  header: React.ReactNode
}

export function ChatPane({
  messages,
  engine,
  deleted,
  showDeleted,
  showTimestamps,
  showPlatform,
  search,
  header
}: ChatPaneProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  /**
   * While the reader scrolls up we render a frozen snapshot instead of the live
   * array. Appends alone would be harmless, but the ring buffer evicts from the
   * front, which shifts every index and yanks the viewport out from under them.
   * Freezing is also what the reader actually wants: it's the "chat paused"
   * behaviour Chatterino and Twitch both have.
   */
  const [frozen, setFrozen] = useState<ChatMessage[] | null>(null)
  const list = frozen ?? messages

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const out: ChatMessage[] = []

    for (const msg of list) {
      if (!showDeleted && deleted[msg.id]) continue
      if (engine.evaluate(msg).hidden) continue
      if (
        needle !== '' &&
        !msg.plainText.toLowerCase().includes(needle) &&
        !msg.authorName.toLowerCase().includes(needle)
      ) {
        continue
      }
      out.push(msg)
    }

    return out
  }, [list, engine, deleted, showDeleted, search])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    overscan: 12,
    getItemKey: useCallback((index: number) => visible[index]?.id ?? index, [visible])
  })

  const scrollToBottom = useCallback(() => {
    if (visible.length === 0) return
    virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })
  }, [virtualizer, visible.length])

  // Follow the tail while pinned. Runs after layout so measured row heights
  // from this render are already applied.
  useLayoutEffect(() => {
    if (pinned) scrollToBottom()
  }, [pinned, visible.length, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= PIN_THRESHOLD_PX
    setPinned((wasPinned) => {
      if (atBottom && !wasPinned) setFrozen(null)
      else if (!atBottom && wasPinned) setFrozen(messages)
      return atBottom
    })
  }, [messages])

  const resume = useCallback(() => {
    setFrozen(null)
    setPinned(true)
  }, [])

  // Unread badge: locate where the frozen snapshot ended in the live array. If
  // its tail has already been evicted, everything on screen is stale.
  const unread = useMemo(() => {
    if (!frozen || frozen.length === 0) return 0
    const tailId = frozen[frozen.length - 1]?.id
    const idx = tailId ? messages.findIndex((m) => m.id === tailId) : -1
    return idx === -1 ? messages.length : messages.length - 1 - idx
  }, [frozen, messages])

  const openLink = useCallback((url: string) => {
    void bridge().api.openExternal(url)
  }, [])

  const items = virtualizer.getVirtualItems()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#12151a]">
      {header}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="chat-scroll absolute inset-0 overflow-y-auto overflow-x-hidden"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {items.map((item) => {
              const msg = visible[item.index]
              if (!msg) return null
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`
                  }}
                >
                  <MessageRow
                    msg={msg}
                    decision={engine.evaluate(msg)}
                    deleted={deleted[msg.id] === true}
                    showTimestamps={showTimestamps}
                    showPlatform={showPlatform}
                    onOpenLink={openLink}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {visible.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-600">
            {list.length === 0 ? 'waiting for messages…' : 'every message is filtered out'}
          </div>
        )}

        {!pinned && (
          <button
            type="button"
            onClick={resume}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 cursor-pointer rounded-full bg-indigo-600 px-3 py-1 text-[13px] font-medium text-white shadow-lg hover:bg-indigo-500"
          >
            {unread > 0 ? `${unread} new message${unread === 1 ? '' : 's'} · ` : ''}
            chat paused — resume ↓
          </button>
        )}
      </div>
    </div>
  )
}

/** Live throughput readout, sampled on its own timer so it never re-renders rows. */
export function useThroughput(received: number): number {
  const [rate, setRate] = useState(0)

  // Written every render, read only by the sampler, so a 10Hz ingest cadence
  // never restarts the interval.
  const latest = useRef(received)
  latest.current = received

  useEffect(() => {
    let last = latest.current
    let at = Date.now()

    const id = setInterval(() => {
      const now = Date.now()
      const elapsed = (now - at) / 1000
      if (elapsed <= 0) return
      setRate(Math.max(0, Math.round((latest.current - last) / elapsed)))
      last = latest.current
      at = now
    }, 1000)

    return () => clearInterval(id)
  }, [])

  return rate
}
