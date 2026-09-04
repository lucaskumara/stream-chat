import { beforeEach, describe, expect, it, vi } from 'vitest'

// ThirdPartyEmotes.lookup used to gate itself by a per-platform enabled setting, pushed in
// from Settings -> Platforms via setEnabled — so toggling a provider off hid it from
// lookup() immediately. That gate meant a name both providers had was still only ever
// resolved to whichever one lookup() preferred, and the fragment built from it carried
// nothing to fall back to if the *other*, still-enabled provider also had that name.
// Filtering now lives entirely in the renderer (see src/renderer/src/emotes.ts's
// selectEmote), off every match lookup() returns rather than the one it used to pick —
// so lookup() itself no longer knows or cares about the settings at all.

const fetchOptionalJson = vi.fn()

vi.mock('@main/emotes/fetchJson', () => ({
  fetchOptionalJson: (url: string) => fetchOptionalJson(url) as unknown
}))

const { ThirdPartyEmotes } = await import('@main/emotes')

beforeEach(() => {
  fetchOptionalJson.mockReset()
})

function twitchResponses(): void {
  fetchOptionalJson.mockImplementation((url: string) => {
    if (url.includes('7tv.io') && url.includes('/users/')) {
      return Promise.resolve({
        emote_set: {
          emotes: [
            { name: 'sevenTvEmote', data: { host: { url: '//cdn/7tv', files: [{ name: '1x.webp' }] } } }
          ]
        }
      })
    }
    if (url.includes('7tv.io')) return Promise.resolve({ emotes: [] })
    if (url.includes('betterttv.net') && url.includes('/users/')) {
      return Promise.resolve({
        channelEmotes: [{ id: 'abc', code: 'bttvEmote' }],
        sharedEmotes: []
      })
    }
    if (url.includes('betterttv.net')) return Promise.resolve([])
    return Promise.resolve(null)
  })
}

describe('ThirdPartyEmotes.lookup', () => {
  it('resolves both a 7TV-only and a BTTV-only name', async () => {
    twitchResponses()
    const emotes = new ThirdPartyEmotes()

    await emotes.load({ platform: 'twitch', channelId: '123' })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'sevenTvEmote')).toMatchObject([
      { provider: '7tv' }
    ])
    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'bttvEmote')).toMatchObject([
      { provider: 'bttv' }
    ])
  })

  it('answers an empty array for a name neither provider has', async () => {
    twitchResponses()
    const emotes = new ThirdPartyEmotes()

    await emotes.load({ platform: 'twitch', channelId: '123' })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'nobodyHasThis')).toEqual([])
  })

  // Both providers are always checked now, regardless of any per-platform setting —
  // there is no setEnabled left to disable one.
  it('returns both matches, 7TV first, for a name both providers have', async () => {
    fetchOptionalJson.mockImplementation((url: string) => {
      if (url.includes('7tv.io') && url.includes('/users/')) {
        return Promise.resolve({
          emote_set: { emotes: [{ name: 'shared', data: { host: { url: '//cdn/7tv', files: [{ name: '1x.webp' }] } } }] }
        })
      }
      if (url.includes('7tv.io')) return Promise.resolve({ emotes: [] })
      if (url.includes('betterttv.net') && url.includes('/users/')) {
        return Promise.resolve({ channelEmotes: [{ id: 'abc', code: 'shared' }], sharedEmotes: [] })
      }
      if (url.includes('betterttv.net')) return Promise.resolve([])
      return Promise.resolve(null)
    })

    const emotes = new ThirdPartyEmotes()
    await emotes.load({ platform: 'twitch', channelId: '123' })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'shared')).toMatchObject([
      { provider: '7tv' },
      { provider: 'bttv' }
    ])
  })

  it('never checks BTTV outside Twitch, which is the only platform BTTV covers', async () => {
    fetchOptionalJson.mockResolvedValue({ emote_set: { emotes: [] } })

    const emotes = new ThirdPartyEmotes()
    await emotes.load({ platform: 'google', channelId: 'UC123' })

    emotes.lookup({ platform: 'google', channelId: 'UC123' }, 'anything')

    expect(fetchOptionalJson.mock.calls.some(([url]) => String(url).includes('betterttv.net'))).toBe(
      false
    )
  })
})
