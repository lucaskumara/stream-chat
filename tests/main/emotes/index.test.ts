import { describe, expect, it } from 'vitest'
import type { Fragment } from '@shared/types'
import { applyEmotes } from '@main/emotes'
import type { ThirdPartyEmote } from '@main/emotes/types'

const GIGACHAD: ThirdPartyEmote = {
  name: 'GIGACHAD',
  url: 'https://cdn.7tv.app/emote/1/1x.webp',
  srcSet: 'https://cdn.7tv.app/emote/1/1x.webp 1x',
  animated: false,
  provider: '7tv'
}

const lookup = (name: string): ThirdPartyEmote | undefined =>
  name === GIGACHAD.name ? GIGACHAD : undefined

describe('applyEmotes', () => {
  it('replaces a whole token with the emote', () => {
    expect(applyEmotes([{ kind: 'text', text: 'GIGACHAD' }], lookup)).toEqual([
      {
        kind: 'emote',
        name: 'GIGACHAD',
        url: GIGACHAD.url,
        srcSet: GIGACHAD.srcSet,
        provider: '7tv'
      }
    ])
  })

  it('keeps the text either side of the emote', () => {
    const fragments = applyEmotes([{ kind: 'text', text: 'what a GIGACHAD move' }], lookup)

    expect(fragments).toEqual([
      { kind: 'text', text: 'what a ' },
      expect.objectContaining({ kind: 'emote', name: 'GIGACHAD' }),
      { kind: 'text', text: ' move' }
    ])
  })

  // Substring matching would turn the name inside a longer word into an image.
  it('does not match inside a longer word', () => {
    for (const text of ['GIGACHADS', 'aGIGACHAD', 'xGIGACHADx']) {
      expect(applyEmotes([{ kind: 'text', text }], lookup)).toEqual([{ kind: 'text', text }])
    }
  })

  it('is case-sensitive, because folding case collides distinct emote names', () => {
    expect(applyEmotes([{ kind: 'text', text: 'gigachad' }], lookup)).toEqual([
      { kind: 'text', text: 'gigachad' }
    ])
  })

  it('replaces every occurrence in one fragment', () => {
    const kinds = applyEmotes(
      [{ kind: 'text', text: 'GIGACHAD and GIGACHAD' }],
      lookup
    ).map((fragment) => fragment.kind)

    expect(kinds).toEqual(['emote', 'text', 'emote'])
  })

  // It runs last, over what the platform's own parsing left behind, so it must not
  // reach into a link, a native emote or a mention.
  it('leaves every non-text fragment untouched', () => {
    const fragments: Fragment[] = [
      { kind: 'link', text: 'GIGACHAD', href: 'https://example.com/GIGACHAD' },
      { kind: 'emote', name: 'GIGACHAD', url: 'https://native/1.png', provider: 'native' },
      { kind: 'mention', text: 'GIGACHAD' }
    ]

    expect(applyEmotes(fragments, lookup)).toEqual(fragments)
  })

  it('hands back the original fragment when nothing matched', () => {
    const fragment: Fragment = { kind: 'text', text: 'nothing here' }

    expect(applyEmotes([fragment], lookup)[0]).toBe(fragment)
  })

  it('keeps the whitespace between tokens', () => {
    expect(applyEmotes([{ kind: 'text', text: 'a  b' }], lookup)).toEqual([
      { kind: 'text', text: 'a  b' }
    ])
  })

  it('carries the provider through, so the renderer can tell 7tv from bttv', () => {
    const [emote] = applyEmotes([{ kind: 'text', text: 'GIGACHAD' }], lookup)

    expect(emote).toMatchObject({ provider: '7tv' })
  })

  it('answers empty for no fragments', () => {
    expect(applyEmotes([], lookup)).toEqual([])
  })
})
