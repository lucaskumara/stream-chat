import type { BrowserWindow } from 'electron'
import type { ChatBatch, ChatMessage, ModerationEvent } from '@shared/types'
import { Backlog } from './backlog'
import { log } from './log'

const FLUSH_INTERVAL_MS = 100

const MAX_BUFFERED_MESSAGES = 2000

/** A sink receives every flushed batch and filters for itself. The window wants all
    of it; an OBS dock wants one source. Keeping the filter in the sink is what lets
    the bus stay a buffer rather than a router. */
export interface BusSink {
  deliver(batch: ChatBatch): void
}

export class MessageBus {
  private messages: ChatMessage[] = []
  private moderation: ModerationEvent[] = []
  private timer: NodeJS.Timeout | null = null
  private sinks = new Set<BusSink>()
  private windowSink: BusSink | null = null
  private dropped = 0

  readonly backlog = new Backlog()

  addSink(sink: BusSink): () => void {
    this.sinks.add(sink)
    this.start()

    return () => {
      this.sinks.delete(sink)
      this.stopWhenIdle()
    }
  }

  attach(window: BrowserWindow): void {
    this.dropWindowSink()

    const sink: BusSink = {
      deliver: (batch) => {
        if (window.isDestroyed()) return
        window.webContents.send('chat:batch', batch)
      }
    }

    this.windowSink = sink
    this.sinks.add(sink)
    this.start()
  }

  detach(): void {
    this.dropWindowSink()
    this.stopWhenIdle()
  }

  push(msg: ChatMessage): void {
    this.messages.push(msg)
    this.backlog.push(msg)

    if (this.messages.length > MAX_BUFFERED_MESSAGES) {
      const over = this.messages.length - MAX_BUFFERED_MESSAGES

      this.messages.splice(0, over)
      this.dropped += over
    }
  }

  pushModeration(evt: ModerationEvent): void {
    this.moderation.push(evt)
    this.backlog.apply(evt)
  }

  dropSource(sourceId: string): void {
    this.messages = this.messages.filter((m) => m.sourceId !== sourceId)
    this.moderation = this.moderation.filter((m) => m.sourceId !== sourceId)
    this.backlog.drop(sourceId)
  }

  private start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  private stopWhenIdle(): void {
    if (this.sinks.size > 0) return

    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }

    this.messages = []
    this.moderation = []
    this.backlog.clear()
  }

  private dropWindowSink(): void {
    if (!this.windowSink) return

    this.sinks.delete(this.windowSink)
    this.windowSink = null
  }

  private flush(): void {
    if (this.messages.length === 0 && this.moderation.length === 0) return

    if (this.sinks.size === 0) {
      this.messages = []
      this.moderation = []
      return
    }

    const batch: ChatBatch = { messages: this.messages, moderation: this.moderation }
    this.messages = []
    this.moderation = []

    if (this.dropped > 0) {
      log('bus').warn(`dropped ${this.dropped} messages that overflowed the buffer`)
      this.dropped = 0
    }

    for (const sink of this.sinks) sink.deliver(batch)
  }
}
