import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { nameColor, readable } from '@/contrast'

function message(authorId: string, authorColor?: string): ChatMessage {
  return {
    id: 'm-1',
    sourceId: 'src-1',
    platform: 'twitch',
    kind: 'chat',
    authorId,
    authorName: 'someone',
    authorColor,
    fragments: [],
    plainText: '',
    timestamp: 0
  }
}

const luminance = (colour: string): number => {
  const parts = colour.startsWith('#')
    ? [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16))
    : colour.slice(4, -1).split(',').map(Number)

  return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255
}

describe('readable on dark', () => {
  // Multiplying each channel by a boost cannot lift a saturated colour at all — #0000FF
  // is already at 255 on its only lit channel — and it is in the default palette.
  it('lifts a saturated dark colour by blending toward white', () => {
    expect(readable('#0000FF', 'dark')).toBe('rgb(90, 90, 255)')
  })

  it('leaves a colour that already clears the floor alone', () => {
    expect(readable('#00FF00', 'dark')).toBe('#00FF00')
  })

  it('falls back for anything that is not a six-digit hex', () => {
    expect(readable('rebeccapurple', 'dark')).toBe('#a1a1a1')
  })
})

describe('readable on light', () => {
  // Scaling down is exact here: this luminance is linear in the channels, so one
  // factor lands the colour on the ceiling and the hue is untouched.
  it('darkens a bright colour onto the ceiling', () => {
    const darkened = readable('#00FF00', 'light')

    expect(darkened).toBe('rgb(0, 178, 0)')
    expect(luminance(darkened)).toBeCloseTo(0.5, 2)
  })

  it('leaves a colour that is already dark enough alone', () => {
    expect(readable('#0000FF', 'light')).toBe('#0000FF')
  })

  it('has its own fallback tone', () => {
    expect(readable('nope', 'light')).toBe('#5f5f5f')
  })
})

describe('nameColor', () => {
  it('uses the author colour when the platform sent one', () => {
    expect(nameColor(message('a-1', '#00FF00'), 'dark', 'author')).toBe('#00FF00')
  })

  it('is stable for one author and readable in both modes', () => {
    const dark = nameColor(message('a-1'), 'dark', 'author')

    expect(nameColor(message('a-1'), 'dark', 'author')).toBe(dark)
    expect(luminance(dark)).toBeGreaterThanOrEqual(0.4)
    expect(luminance(nameColor(message('a-1'), 'light', 'author'))).toBeLessThanOrEqual(0.51)
  })

  // 'platform' paints every name with its own message's platform colour, whatever
  // the author sent — the whole point is to tell platforms apart in a merged column.
  it('uses the platform colour, ignoring any author colour, in platform mode', () => {
    expect(nameColor(message('a-1', '#00FF00'), 'dark', 'platform')).toBe(
      readable('#9146ff', 'dark')
    )
  })

  it('lifts the platform colour for readability the same as any other colour', () => {
    expect(luminance(nameColor(message('a-1'), 'dark', 'platform'))).toBeCloseTo(0.4, 2)
  })

  // 'none' drops colour in favour of the same heading tone the rest of the chrome
  // uses for emphasis, not a hardcoded black or white — so it still inverts with
  // the theme rather than needing its own light/dark branch here.
  it('returns the heading token in none mode, regardless of author colour', () => {
    expect(nameColor(message('a-1', '#00FF00'), 'dark', 'none')).toBe('var(--heading)')
    expect(nameColor(message('a-1'), 'light', 'none')).toBe('var(--heading)')
  })
})
