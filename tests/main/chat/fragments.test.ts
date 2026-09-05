import { describe, expect, it } from 'vitest'
import { REPLY_EXCERPT_LIMIT, plainTextOf } from '@main/chat/fragments'

describe('plainTextOf', () => {
  it('joins text fragments untouched', () => {
    expect(
      plainTextOf([
        { kind: 'text', text: 'hello ' },
        { kind: 'text', text: 'there' },
      ]),
    ).toBe('hello there')
  })

  it('stands an emote in for its name, not its url', () => {
    expect(
      plainTextOf([
        { kind: 'text', text: 'nice ' },
        { kind: 'emote', name: 'Kappa', url: 'https://cdn/1.png' },
      ]),
    ).toBe('nice Kappa')
  })

  it('uses the visible text of a link, not its href', () => {
    expect(
      plainTextOf([
        { kind: 'link', text: 'example.com', href: 'https://example.com' },
      ]),
    ).toBe('example.com')
  })

  it('keeps a mention as its text', () => {
    expect(
      plainTextOf([{ kind: 'mention', text: '@someone', userId: '7' }]),
    ).toBe('@someone')
  })

  it('answers empty for no fragments', () => {
    expect(plainTextOf([])).toBe('')
  })
})

describe('REPLY_EXCERPT_LIMIT', () => {
  it('is the one excerpt length every platform slices to', () => {
    expect(REPLY_EXCERPT_LIMIT).toBe(60)
  })
})
