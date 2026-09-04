import { describe, expect, it } from 'vitest'
import { emoteProviderEnabled, selectEmote } from '@/emotes'

describe('emoteProviderEnabled', () => {
  it('is enabled when the provider settings are not known yet', () => {
    expect(emoteProviderEnabled('7tv', undefined)).toBe(true)
    expect(emoteProviderEnabled('bttv', undefined)).toBe(true)
  })

  it('follows the 7TV flag for a 7TV fragment', () => {
    expect(emoteProviderEnabled('7tv', { sevenTv: true, bttv: true })).toBe(true)
    expect(emoteProviderEnabled('7tv', { sevenTv: false, bttv: true })).toBe(false)
  })

  it('follows the BTTV flag for a BTTV fragment', () => {
    expect(emoteProviderEnabled('bttv', { sevenTv: true, bttv: true })).toBe(true)
    expect(emoteProviderEnabled('bttv', { sevenTv: true, bttv: false })).toBe(false)
  })

  // A native emote (Twitch/Kick/YouTube's own) is not gated by either toggle —
  // only third-party fragments carry a provider the settings screen controls.
  it('is always enabled for a native emote', () => {
    expect(emoteProviderEnabled('native', { sevenTv: false, bttv: false })).toBe(true)
    expect(emoteProviderEnabled(undefined, { sevenTv: false, bttv: false })).toBe(true)
  })
})

const SEVENTV = { provider: '7tv' as const, url: 'https://cdn.7tv/x.webp' }
const BTTV = { provider: 'bttv' as const, url: 'https://cdn.betterttv/x.png' }

describe('selectEmote', () => {
  // The bug this pins: a name that both 7TV and BTTV have was previously fixed
  // to whichever one main happened to keep, so toggling 7TV off and BTTV on for
  // the same emote fell through to plain text instead of the BTTV image that
  // was there the whole time.
  it('falls through to an alternate once the primary provider is disabled', () => {
    expect(selectEmote(SEVENTV, [BTTV], { sevenTv: false, bttv: true })).toEqual(BTTV)
  })

  it('keeps the primary when it is still enabled, ignoring the alternates', () => {
    expect(selectEmote(SEVENTV, [BTTV], { sevenTv: true, bttv: true })).toEqual(SEVENTV)
  })

  it('falls through in priority order across more than one alternate', () => {
    const third = { provider: 'bttv' as const, url: 'https://cdn.betterttv/y.png' }
    expect(
      selectEmote(SEVENTV, [BTTV, third], { sevenTv: false, bttv: true })
    ).toEqual(BTTV)
  })

  it('returns null once every candidate is disabled, for the caller to render as text', () => {
    expect(selectEmote(SEVENTV, [BTTV], { sevenTv: false, bttv: false })).toBeNull()
  })

  it('has nothing to fall through to when there are no alternates', () => {
    expect(selectEmote(SEVENTV, undefined, { sevenTv: false, bttv: true })).toBeNull()
  })

  it('keeps a native emote regardless of either toggle', () => {
    const native = { provider: 'native' as const, url: 'https://platform/native.png' }
    expect(selectEmote(native, undefined, { sevenTv: false, bttv: false })).toEqual(native)
  })
})
