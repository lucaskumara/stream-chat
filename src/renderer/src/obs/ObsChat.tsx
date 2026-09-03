import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatBatch, ChatMessage, SourceState } from '@shared/types'
import { OBS_SOCKET_PATH } from '@shared/obs'
import type { ObsFrame } from '@shared/obs'
import { MessageRow } from '../components/MessageRow'
import type { DockOptions } from './options'

const CAPACITY = 200

const PIN_THRESHOLD_PX = 40

const RECONNECT_BASE_MS = 500
const RECONNECT_CEILING_MS = 10000

interface Feed {
  messages: ChatMessage[]
  deleted: Record<string, true>
}

const EMPTY: Feed = { messages: [], deleted: {} }

function reconnectDelay(attempt: number): number {
  const capped = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_CEILING_MS)

  return capped / 2 + Math.random() * (capped / 2)
}

function ingest(held: Feed, batch: ChatBatch): Feed {
  let messages = held.messages
  let deleted = held.deleted

  if (batch.messages.length > 0) {
    messages = messages.concat(batch.messages)
    if (messages.length > CAPACITY) messages = messages.slice(messages.length - CAPACITY)
  }

  for (const event of batch.moderation) {
    switch (event.type) {
      case 'delete-message':
        deleted = { ...deleted, [event.messageId]: true }
        break

      case 'clear-user': {
        const next = { ...deleted }
        for (const message of messages) {
          if (message.authorId === event.userId) next[message.id] = true
        }
        deleted = next
        break
      }

      case 'clear-chat':
        messages = []
        break
    }
  }

  return { messages, deleted }
}

function openLink(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer')
}

function Notice({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="px-2 py-1 text-[13px]" style={{ color: 'var(--fg-4)' }}>
      {children}
    </div>
  )
}

export function ObsChat({ options }: { options: DockOptions }): React.ReactElement {
  const [feed, setFeed] = useState<Feed>(EMPTY)
  const [source, setSource] = useState<SourceState | null>(null)
  const [linked, setLinked] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)

  useEffect(() => {
    const target = `platform=${encodeURIComponent(options.platform)}&channel=${encodeURIComponent(options.channel)}`

    let socket: WebSocket | null = null
    let retry: number | null = null
    let attempt = 0
    let stopped = false

    const apply = (frame: ObsFrame): void => {
      switch (frame.type) {
        case 'sync':
          setSource(frame.source)
          setFeed({ messages: frame.messages.slice(-CAPACITY), deleted: {} })
          break

        case 'status':
          setSource(frame.source)
          break

        case 'batch':
          setFeed((held) => ingest(held, frame.batch))
          break
      }
    }

    const open = (): void => {
      socket = new WebSocket(`ws://${location.host}${OBS_SOCKET_PATH}?${target}`)

      socket.onopen = () => {
        attempt = 0
        setLinked(true)
      }

      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return

        // The dock has no error boundary and no console anyone reads. A throw here
        // kills the handler for the life of the socket, so the page goes silent
        // rather than dropping one frame.
        try {
          apply(JSON.parse(event.data) as ObsFrame)
        } catch {
          return
        }
      }

      socket.onerror = () => socket?.close()

      socket.onclose = () => {
        setLinked(false)
        if (stopped) return

        retry = window.setTimeout(open, reconnectDelay(attempt++))
      }
    }

    open()

    return () => {
      stopped = true
      if (retry !== null) window.clearTimeout(retry)
      socket?.close()
    }
  }, [options.platform, options.channel])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element || !pinnedRef.current) return

    element.scrollTop = element.scrollHeight
  }, [feed.messages])

  const handleScroll = (): void => {
    const element = scrollRef.current
    if (!element) return

    pinnedRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= PIN_THRESHOLD_PX
  }

  const stalled = !linked
    ? 'lost the link to stream-chat — reconnecting…'
    : !source
      ? `waiting for ${options.channel} to be added in stream-chat…`
      : source.status !== 'connected'
        ? `${source.label} — ${source.error ?? source.status}`
        : null

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={
        {
          background: options.transparent ? 'transparent' : 'var(--ink-900)',
          '--chat-font-size': `${options.fontSize}px`
        } as React.CSSProperties
      }
    >
      {stalled && <Notice>{stalled}</Notice>}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        {feed.messages.map((message) => (
          <MessageRow
            key={message.id}
            msg={message}
            deleted={feed.deleted[message.id] === true}
            showTimestamps={options.showTimestamps}
            showPlatform={false}
            onOpenLink={openLink}
          />
        ))}
      </div>
    </div>
  )
}
