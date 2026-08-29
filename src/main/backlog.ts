import type { ChatMessage, ModerationEvent } from '@shared/types'

const PER_SOURCE_LIMIT = 200

/** Main keeps no history of its own — the 500-message ring lives in the renderer
    store. An OBS dock opening mid-stream has no store to read, so it would sit
    blank until the next message arrived. This is the replay it gets on connect. */
export class Backlog {
  private bySource = new Map<string, ChatMessage[]>()

  push(message: ChatMessage): void {
    const held = this.bySource.get(message.sourceId)
    if (!held) {
      this.bySource.set(message.sourceId, [message])
      return
    }

    held.push(message)
    if (held.length > PER_SOURCE_LIMIT) held.splice(0, held.length - PER_SOURCE_LIMIT)
  }

  apply(event: ModerationEvent): void {
    const held = this.bySource.get(event.sourceId)
    if (!held) return

    switch (event.type) {
      case 'delete-message':
        this.bySource.set(
          event.sourceId,
          held.filter((message) => message.id !== event.messageId)
        )
        break

      case 'clear-user':
        this.bySource.set(
          event.sourceId,
          held.filter((message) => message.authorId !== event.userId)
        )
        break

      case 'clear-chat':
        this.bySource.set(event.sourceId, [])
        break
    }
  }

  history(sourceId: string): ChatMessage[] {
    return this.bySource.get(sourceId) ?? []
  }

  drop(sourceId: string): void {
    this.bySource.delete(sourceId)
  }

  clear(): void {
    this.bySource.clear()
  }
}
