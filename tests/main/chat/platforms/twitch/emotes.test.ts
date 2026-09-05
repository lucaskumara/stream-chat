import { describe, expect, it } from 'vitest'
import { twitchEmote } from '@main/chat/platforms/twitch/emotes'

const CDN = 'https://static-cdn.jtvnw.net/emoticons/v2'

describe('twitchEmote', () => {
  it('builds the default variant when no formats are known, which is the IRC path', () => {
    expect(twitchEmote('25', 'Kappa')).toEqual({
      kind: 'emote',
      name: 'Kappa',
      url: `${CDN}/25/default/dark/1.0`,
      srcSet: `${CDN}/25/default/dark/1.0 1x, ${CDN}/25/default/dark/2.0 2x, ${CDN}/25/default/dark/3.0 3x`,
      provider: 'native',
    })
  })

  it('asks for the animated variant when EventSub says the emote has one', () => {
    expect(twitchEmote('99', 'Pog', ['static', 'animated'])).toMatchObject({
      url: `${CDN}/99/animated/dark/1.0`,
    })
  })

  it('asks for the static variant when EventSub lists no animation', () => {
    expect(twitchEmote('99', 'Pog', ['static'])).toMatchObject({
      url: `${CDN}/99/static/dark/1.0`,
    })
  })

  it('treats an empty format list as static, not as the IRC default', () => {
    expect(twitchEmote('99', 'Pog', [])).toMatchObject({
      url: `${CDN}/99/static/dark/1.0`,
    })
  })

  it('offers three scales, so the row stays sharp at any chat font size', () => {
    const emote = twitchEmote('25', 'Kappa')

    expect(emote.kind === 'emote' && emote.srcSet?.split(', ')).toHaveLength(3)
  })

  it("marks the emote as the platform's own, not a third-party one", () => {
    expect(twitchEmote('25', 'Kappa')).toMatchObject({ provider: 'native' })
  })
})
