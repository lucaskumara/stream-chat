import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, MessageSquare } from 'lucide-react'
import type { ChatMessage, SourceState } from '@shared/types'
import { bridge } from '../bridge'
import { authorTerm, matchesSearch, parseSearch } from '../search'
import type { Density } from '../store'
import { ChatPaneBar } from './ChatPaneBar'
import { ChatSettings } from './ChatSettings'
import { EmptyBlock } from './controls'
import { MessageRow } from './MessageRow'

const PIN_THRESHOLD_PX = 40
const ESTIMATED_ROW_PX = 26

export interface ChatPaneProps {
  source: SourceState
  messages: ChatMessage[]
  deleted: Record<string, true>
  showDeleted: boolean
  showTimestamps: boolean
  density: Density
  filterOpen: boolean
  gearOpen: boolean
  onToggleFilter: () => void
  onToggleGear: () => void
  searchTerms: string[]
  searchDraft: string
  onSearchTerms: (terms: string[]) => void
  onSearchDraft: (draft: string) => void
  onAddSearchTerm: (term: string) => void
  fontSize: number
  onFontStep: (steps: number) => void
  onFontReset: () => void
  onClear: () => void
}

export function ChatPane({
  source,
  messages,
  deleted,
  showDeleted,
  showTimestamps,
  density,
  filterOpen,
  gearOpen,
  onToggleFilter,
  onToggleGear,
  searchTerms,
  searchDraft,
  onSearchTerms,
  onSearchDraft,
  onAddSearchTerm,
  fontSize,
  onFontStep,
  onFontReset,
  onClear
}: ChatPaneProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const [frozen, setFrozen] = useState<ChatMessage[] | null>(null)
  const list = frozen ?? messages

  const terms = useMemo(
    () => parseSearch([...searchTerms, searchDraft]),
    [searchTerms, searchDraft]
  )

  const visible = useMemo(() => {
    const out: ChatMessage[] = []

    for (const msg of list) {
      if (!showDeleted && deleted[msg.id]) continue
      if (terms.length > 0 && !matchesSearch(msg, terms)) continue

      out.push(msg)
    }

    return out
  }, [list, deleted, showDeleted, terms])

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

  const unread = useMemo(() => {
    if (!frozen || frozen.length === 0) return 0
    const tailId = frozen[frozen.length - 1]?.id
    const idx = tailId ? messages.findIndex((m) => m.id === tailId) : -1
    return idx === -1 ? messages.length : messages.length - 1 - idx
  }, [frozen, messages])

  const openLink = useCallback((url: string) => {
    void bridge().api.openExternal(url)
  }, [])

  // Delegated so MessageRow gains an attribute rather than a callback prop — a new
  // prop on every batch would defeat its memo across every row on screen.
  const filterByAuthor = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = (event.target as HTMLElement).closest('[data-author]')
      const author = target?.getAttribute('data-author')
      if (!author) return

      onAddSearchTerm(authorTerm(author))
    },
    [onAddSearchTerm]
  )

  const items = virtualizer.getVirtualItems()

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={
        {
          height: '100%',
          background: 'var(--ink-900)',
          '--chat-font-size': `${fontSize}px`
        } as React.CSSProperties
      }
    >
      <ChatPaneBar
        source={source}
        filterOpen={filterOpen}
        gearOpen={gearOpen}
        terms={searchTerms}
        draft={searchDraft}
        matches={visible.length}
        total={list.length}
        onToggleFilter={onToggleFilter}
        onToggleGear={onToggleGear}
        onTerms={onSearchTerms}
        onDraft={onSearchDraft}
      />

      {gearOpen && (
        <ChatSettings
          sourceId={source.id}
          fontSize={fontSize}
          onFontStep={onFontStep}
          onFontReset={onFontReset}
          onClear={onClear}
        />
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onClick={filterByAuthor}
          className="chat-scroll absolute inset-0 overflow-x-hidden overflow-y-auto pb-[8px]"
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
                    deleted={deleted[msg.id] === true}
                    showTimestamps={showTimestamps}
                    showPlatform={false}
                    compact={density === 'compact'}
                    onOpenLink={openLink}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {visible.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <EmptyBlock
              icon={MessageSquare}
              detail={
                list.length === 0 ? 'Waiting for messages…' : 'Every message is filtered out.'
              }
            />
          </div>
        )}

        {!pinned && (
          <button
            type="button"
            onClick={resume}
            className="absolute left-1/2 flex h-[26px] cursor-pointer items-center gap-[6px] px-[12px] text-[13px]"
            style={{
              bottom: 10,
              transform: 'translateX(-50%)',
              background: '#2b2b2b',
              border: '1px solid var(--line-2)',
              borderRadius: 999,
              color: '#ededed',
              boxShadow: '0 6px 18px rgba(0,0,0,.5)'
            }}
          >
            <ArrowDown size={14} strokeWidth={1.8} />
            {unread > 0 ? `${unread} new · paused` : 'paused'}
          </button>
        )}
      </div>
    </div>
  )
}
