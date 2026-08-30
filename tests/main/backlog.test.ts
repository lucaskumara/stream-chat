import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { Backlog } from '@main/backlog'

function message(id: string, sourceId = 'src-1', authorId = 'author-1'): ChatMessage {
  return {
    id,
    sourceId,
    platform: 'twitch',
    kind: 'chat',
    authorId,
    authorName: 'someone',
    fragments: [{ kind: 'text', text: id }],
    plainText: id,
    timestamp: 0
  }
}

describe('Backlog', () => {
  it('starts empty for a source it has never seen', () => {
    expect(new Backlog().history('src-1')).toEqual([])
  })

  it('replays what it was given, oldest first', () => {
    const backlog = new Backlog()
    backlog.push(message('a'))
    backlog.push(message('b'))

    expect(backlog.history('src-1').map((held) => held.id)).toEqual(['a', 'b'])
  })

  it('keeps each source apart', () => {
    const backlog = new Backlog()
    backlog.push(message('a', 'src-1'))
    backlog.push(message('b', 'src-2'))

    expect(backlog.history('src-1').map((held) => held.id)).toEqual(['a'])
    expect(backlog.history('src-2').map((held) => held.id)).toEqual(['b'])
  })

  it('holds two hundred messages per source and evicts from the front', () => {
    const backlog = new Backlog()
    for (let at = 0; at < 250; at++) backlog.push(message(`m${at}`))

    const held = backlog.history('src-1')

    expect(held).toHaveLength(200)
    expect(held[0]?.id).toBe('m50')
    expect(held[199]?.id).toBe('m249')
  })

  // A dock joining later has no way to show a strikethrough for a deletion it never
  // saw, so history carries the message away rather than marking it.
  it('removes a deleted message rather than marking it', () => {
    const backlog = new Backlog()
    backlog.push(message('a'))
    backlog.push(message('b'))

    backlog.apply({ type: 'delete-message', sourceId: 'src-1', messageId: 'a' })

    expect(backlog.history('src-1').map((held) => held.id)).toEqual(['b'])
  })

  it('removes every message from a cleared user', () => {
    const backlog = new Backlog()
    backlog.push(message('a', 'src-1', 'troll'))
    backlog.push(message('b', 'src-1', 'regular'))
    backlog.push(message('c', 'src-1', 'troll'))

    backlog.apply({ type: 'clear-user', sourceId: 'src-1', userId: 'troll' })

    expect(backlog.history('src-1').map((held) => held.id)).toEqual(['b'])
  })

  it('empties the source on a chat clear', () => {
    const backlog = new Backlog()
    backlog.push(message('a'))

    backlog.apply({ type: 'clear-chat', sourceId: 'src-1' })

    expect(backlog.history('src-1')).toEqual([])
  })

  it('leaves other sources alone when moderation lands', () => {
    const backlog = new Backlog()
    backlog.push(message('a', 'src-1'))
    backlog.push(message('b', 'src-2'))

    backlog.apply({ type: 'clear-chat', sourceId: 'src-1' })

    expect(backlog.history('src-2')).toHaveLength(1)
  })

  it('ignores moderation for a source it holds nothing for', () => {
    const backlog = new Backlog()

    expect(() =>
      backlog.apply({ type: 'clear-chat', sourceId: 'nobody' })
    ).not.toThrow()
  })

  it('forgets a dropped source', () => {
    const backlog = new Backlog()
    backlog.push(message('a'))

    backlog.drop('src-1')

    expect(backlog.history('src-1')).toEqual([])
  })

  it('forgets every source on clear', () => {
    const backlog = new Backlog()
    backlog.push(message('a', 'src-1'))
    backlog.push(message('b', 'src-2'))

    backlog.clear()

    expect(backlog.history('src-1')).toEqual([])
    expect(backlog.history('src-2')).toEqual([])
  })
})
