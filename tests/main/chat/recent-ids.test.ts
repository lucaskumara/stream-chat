import { describe, expect, it } from 'vitest'
import { RecentIds } from '@main/chat/recent-ids'

describe('RecentIds', () => {
  it('remembers what it has been given', () => {
    const seen = new RecentIds(10)
    seen.add('a')

    expect(seen.has('a')).toBe(true)
    expect(seen.has('b')).toBe(false)
  })

  it('evicts the oldest id once it is over its limit', () => {
    const seen = new RecentIds(2)
    seen.add('a')
    seen.add('b')
    seen.add('c')

    expect(seen.has('a')).toBe(false)
    expect(seen.has('b')).toBe(true)
    expect(seen.has('c')).toBe(true)
  })

  it('does not let a repeat push the oldest id out', () => {
    const seen = new RecentIds(2)
    seen.add('a')
    seen.add('b')
    seen.add('b')

    expect(seen.has('a')).toBe(true)
  })

  it('holds exactly its limit before evicting', () => {
    const seen = new RecentIds(3)
    for (const id of ['a', 'b', 'c']) seen.add(id)

    expect(['a', 'b', 'c'].every((id) => seen.has(id))).toBe(true)
  })
})
