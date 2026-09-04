import { describe, expect, it } from 'vitest'
import { emoteProviderEnabled } from '@/emotes'

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
