import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Empty, Flex } from 'antd'
import { ArrowDownOutlined } from '@ant-design/icons'
import type { ChatMessage } from '@shared/types'
import { bridge } from '../bridge'
import { INK } from '../theme'
import { MessageRow } from './MessageRow'

const PIN_THRESHOLD_PX = 40
const ESTIMATED_ROW_PX = 26

export interface ChatPaneProps {
  messages: ChatMessage[]
  deleted: Record<string, true>
  showDeleted: boolean
  showTimestamps: boolean
  showPlatform: boolean
  search: string
}

export function ChatPane({
  messages,
  deleted,
  showDeleted,
  showTimestamps,
  showPlatform,
  search
}: ChatPaneProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const [frozen, setFrozen] = useState<ChatMessage[] | null>(null)
  const list = frozen ?? messages

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const out: ChatMessage[] = []

    for (const msg of list) {
      if (!showDeleted && deleted[msg.id]) continue
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
  }, [list, deleted, showDeleted, search])

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

  const items = virtualizer.getVirtualItems()

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ height: '100%', background: INK.app }}
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="chat-scroll absolute inset-0 overflow-x-hidden overflow-y-auto"
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
                    showPlatform={showPlatform}
                    onOpenLink={openLink}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {visible.length === 0 && (
          <Flex
            align="center"
            justify="center"
            className="pointer-events-none absolute inset-0"
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                list.length === 0 ? 'waiting for messages…' : 'every message is filtered out'
              }
            />
          </Flex>
        )}

        {!pinned && (
          <Button
            type="primary"
            shape="round"
            size="small"
            icon={<ArrowDownOutlined />}
            onClick={resume}
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)'
            }}
          >
            {unread > 0 ? `${unread} new · ` : ''}chat paused — resume
          </Button>
        )}
      </div>
    </div>
  )
}
