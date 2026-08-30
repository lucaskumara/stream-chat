import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { ChatBatch, ChatMessage } from '@shared/types'
import { MessageBus } from './bus'

const FLUSH_INTERVAL_MS = 100

function message(id: string, sourceId = 'src-1'): ChatMessage {
  return {
    id,
    sourceId,
    platform: 'twitch',
    kind: 'chat',
    authorId: 'author-1',
    authorName: 'someone',
    fragments: [{ kind: 'text', text: id }],
    plainText: id,
    timestamp: 0
  }
}

function collector(): { batches: ChatBatch[]; deliver: (batch: ChatBatch) => void } {
  const batches: ChatBatch[] = []

  return { batches, deliver: (batch) => batches.push(batch) }
}

describe('MessageBus', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('batches everything pushed inside one interval into a single delivery', () => {
    const bus = new MessageBus()
    const sink = collector()
    bus.addSink(sink)

    bus.push(message('a'))
    bus.push(message('b'))
    bus.push(message('c'))

    expect(sink.batches).toHaveLength(0)

    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches).toHaveLength(1)
    expect(sink.batches[0]?.messages.map((held) => held.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not deliver an empty batch on a quiet interval', () => {
    const bus = new MessageBus()
    const sink = collector()
    bus.addSink(sink)

    vi.advanceTimersByTime(FLUSH_INTERVAL_MS * 5)

    expect(sink.batches).toHaveLength(0)
  })

  it('empties its buffers between flushes', () => {
    const bus = new MessageBus()
    const sink = collector()
    bus.addSink(sink)

    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)
    bus.push(message('b'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches.map((batch) => batch.messages.map((held) => held.id))).toEqual([
      ['a'],
      ['b']
    ])
  })

  it('carries moderation alongside messages', () => {
    const bus = new MessageBus()
    const sink = collector()
    bus.addSink(sink)

    bus.pushModeration({ type: 'clear-chat', sourceId: 'src-1' })
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches[0]?.moderation).toEqual([{ type: 'clear-chat', sourceId: 'src-1' }])
  })

  it('hands the same batch to every sink', () => {
    const bus = new MessageBus()
    const first = collector()
    const second = collector()
    bus.addSink(first)
    bus.addSink(second)

    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(first.batches).toHaveLength(1)
    expect(second.batches).toHaveLength(1)
  })

  it('stops delivering to a detached sink', () => {
    const bus = new MessageBus()
    const sink = collector()
    const detach = bus.addSink(sink)

    detach()
    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches).toHaveLength(0)
  })

  it('drops the overflow past two thousand buffered messages and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bus = new MessageBus()
    const sink = collector()
    bus.addSink(sink)

    for (let at = 0; at < 2100; at++) bus.push(message(`m${at}`))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches[0]?.messages).toHaveLength(2000)
    expect(sink.batches[0]?.messages[0]?.id).toBe('m100')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped'))

    warn.mockRestore()
  })

  it('keeps a backlog of what it has seen, for a dock joining later', () => {
    const bus = new MessageBus()
    bus.addSink(collector())

    bus.push(message('a'))

    expect(bus.backlog.history('src-1').map((held) => held.id)).toEqual(['a'])
  })

  it('applies moderation to the backlog as well as passing it on', () => {
    const bus = new MessageBus()
    bus.addSink(collector())

    bus.push(message('a'))
    bus.pushModeration({ type: 'delete-message', sourceId: 'src-1', messageId: 'a' })

    expect(bus.backlog.history('src-1')).toEqual([])
  })

  it('forgets a dropped source everywhere at once', () => {
    const bus = new MessageBus()
    const sink = collector()
    bus.addSink(sink)

    bus.push(message('a', 'src-1'))
    bus.push(message('b', 'src-2'))
    bus.dropSource('src-1')
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches[0]?.messages.map((held) => held.id)).toEqual(['b'])
    expect(bus.backlog.history('src-1')).toEqual([])
  })

  // The timer runs while any sink exists, so the buffers are cleared on the last
  // removal rather than on detach() alone.
  it('clears its buffers once the last sink is gone', () => {
    const bus = new MessageBus()
    const detach = bus.addSink(collector())

    bus.push(message('a'))
    detach()

    const sink = collector()
    bus.addSink(sink)
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(sink.batches).toHaveLength(0)
  })

  it('sends a batch to an attached window over the chat channel', () => {
    const bus = new MessageBus()
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } }

    bus.attach(window as unknown as BrowserWindow)
    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(send).toHaveBeenCalledWith('chat:batch', expect.objectContaining({ messages: [expect.objectContaining({ id: 'a' })] }))
  })

  it('says nothing to a destroyed window', () => {
    const bus = new MessageBus()
    const send = vi.fn()
    const window = { isDestroyed: () => true, webContents: { send } }

    bus.attach(window as unknown as BrowserWindow)
    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(send).not.toHaveBeenCalled()
  })

  it('replaces the window sink rather than stacking a second one', () => {
    const bus = new MessageBus()
    const first = vi.fn()
    const second = vi.fn()

    bus.attach({ isDestroyed: () => false, webContents: { send: first } } as unknown as BrowserWindow)
    bus.attach({ isDestroyed: () => false, webContents: { send: second } } as unknown as BrowserWindow)

    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('stops sending once the window detaches', () => {
    const bus = new MessageBus()
    const send = vi.fn()

    bus.attach({ isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow)
    bus.detach()

    bus.push(message('a'))
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS)

    expect(send).not.toHaveBeenCalled()
  })
})
