import { describe, expect, it } from 'vitest'
import { parseForPlatform } from '@/connect'

describe('parseForPlatform', () => {
  it('takes a bare name on the platform whose tab is open', () => {
    expect(parseForPlatform('theburntpeanut', 'twitch').ref).toMatchObject({
      platform: 'twitch',
      value: 'theburntpeanut'
    })
  })

  it('takes that platform own link', () => {
    expect(parseForPlatform('https://kick.com/xqc', 'kick').ref).toMatchObject({
      platform: 'kick',
      value: 'xqc'
    })
  })

  // Each tab is bound to one platform: a link that resolves elsewhere parses fine and
  // would otherwise open a chat on the tab next door.
  it('refuses a link belonging to another platform', () => {
    const parsed = parseForPlatform('https://youtube.com/@LofiGirl', 'kick')

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('YouTube')
  })

  // A UC id describes itself as YouTube whatever hint it is given.
  it('refuses a self-describing name belonging to another platform', () => {
    const parsed = parseForPlatform('UCSJ4gkVC6NrvII8umztf0Ow', 'twitch')

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('YouTube')
  })

  it('passes the shape error through', () => {
    const parsed = parseForPlatform('ab', 'twitch')

    expect(parsed.ok).toBe(false)
    expect(parsed.error).toContain('not a valid Twitch channel name')
  })
})
