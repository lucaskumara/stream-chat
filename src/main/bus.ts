import type { BrowserWindow } from 'electron'
import type { ChatBatch, ChatMessage, ModerationEvent } from '@shared/types'

const FLUSH_INTERVAL_MS = 100

/**
 * Hard cap on a single flush. If the renderer stalls (devtools open, a long GC)
 * the buffer must not grow without bound — chat is a live feed, so dropping the
 * oldest surplus is the right failure mode.
 */
const MAX_BUFFERED_MESSAGES = 2000

/**
 * Buffers messages and ships them to the renderer on a fixed tick. A busy
 * channel produces tens of messages per second and one IPC call per message
 * saturates the renderer with structured-clone work.
 */
export class MessageBus {
  private messages: ChatMessage[] = []
  private moderation: ModerationEvent[] = []
  private timer: NodeJS.Timeout | null = null
  private window: BrowserWindow | null = null
  private dropped = 0

  attach(window: BrowserWindow): void {
    this.window = window
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  detach(): void {
    this.window = null
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.messages = []
    this.moderation = []
  }

  push(msg: ChatMessage): void {
    this.messages.push(msg)
    if (this.messages.length > MAX_BUFFERED_MESSAGES) {
      this.messages.splice(0, this.messages.length - MAX_BUFFERED_MESSAGES)
      this.dropped++
    }
  }

  pushModeration(evt: ModerationEvent): void {
    this.moderation.push(evt)
  }

  /** Discard anything still queued for a source that has been removed. */
  dropSource(sourceId: string): void {
    this.messages = this.messages.filter((m) => m.sourceId !== sourceId)
    this.moderation = this.moderation.filter((m) => m.sourceId !== sourceId)
  }

  private flush(): void {
    if (this.messages.length === 0 && this.moderation.length === 0) return

    const window = this.window
    if (!window || window.isDestroyed()) {
      this.messages = []
      this.moderation = []
      return
    }

    const batch: ChatBatch = { messages: this.messages, moderation: this.moderation }
    this.messages = []
    this.moderation = []

    if (this.dropped > 0) {
      console.warn(`[bus] dropped ${this.dropped} overflow batches`)
      this.dropped = 0
    }

    window.webContents.send('chat:batch', batch)
  }
}
