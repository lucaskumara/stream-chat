import { describe, expect, it } from 'vitest'
import type { ChatMessage, Platform } from '@shared/types'
import { mergeMessages } from '@/merge'

function message(id: string, timestamp: number, platform: Platform = 'twitch'): ChatMessage {
  return {
    id,
    sourceId: platform,
    platform,
    kind: 'chat',
    authorId: 'a',
    authorName: 'someone',
    fragments: [{ kind: 'text', text: id }],
    plainText: id,
    timestamp
  }
}

const ids = (msgs: ChatMessage[]): string[] => msgs.map((msg) => msg.id)

describe('mergeMessages', () => {
  it('interleaves the lists by timestamp', () => {
    const merged = mergeMessages([
      [message('a', 1), message('c', 3), message('e', 9)],
      [message('b', 2), message('d', 4)]
    ])

    expect(ids(merged)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  // Ties keep the order the sources are listed in, which is tab order — otherwise a
  // busy second the two chats share would shuffle on every batch.
  it('breaks a tie by the order the lists are given in', () => {
    const merged = mergeMessages([
      [message('first', 5, 'twitch')],
      [message('second', 5, 'kick')]
    ])

    expect(ids(merged)).toEqual(['first', 'second'])
  })

  it('skips empty lists', () => {
    const merged = mergeMessages([[], [message('a', 1)], []])

    expect(ids(merged)).toEqual(['a'])
  })

  it('hands back the only list untouched', () => {
    const only = [message('a', 1)]

    expect(mergeMessages([only, []])).toBe(only)
  })

  it('has nothing to merge when every list is empty', () => {
    expect(mergeMessages([[], []])).toEqual([])
  })
})
