import { beforeEach, describe, expect, it, vi } from 'vitest'

// ThirdPartyEmotes.lookup used to try 7TV then (Twitch-only) BTTV unconditionally. Settings
// -> Platforms now lets a user turn either off per platform, and the toggle has to take
// effect on the next message with no reconnect — so filtering has to live in lookup(), not
// in load(). These pin that behaviour without pulling in Electron: emotes/index.ts has no
// electron dependency today (see fetchJson mock below), and it must stay that way.

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

describe('ThirdPartyEmotes provider gating', () => {
  it('resolves both a 7TV and a BTTV emote by default, with no setEnabled call', async () => {
    twitchResponses()
    const emotes = new ThirdPartyEmotes()

    await emotes.load({ platform: 'twitch', channelId: '123' })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'sevenTvEmote')?.provider).toBe(
      '7tv'
    )
    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'bttvEmote')?.provider).toBe(
      'bttv'
    )
  })

  it('hides 7TV but keeps BTTV when only 7TV is disabled', async () => {
    twitchResponses()
    const emotes = new ThirdPartyEmotes()
    emotes.setEnabled('twitch', { sevenTv: false, bttv: true })

    await emotes.load({ platform: 'twitch', channelId: '123' })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'sevenTvEmote')).toBeUndefined()
    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'bttvEmote')?.provider).toBe(
      'bttv'
    )
  })

  it('hides BTTV but keeps 7TV when only BTTV is disabled', async () => {
    twitchResponses()
    const emotes = new ThirdPartyEmotes()
    emotes.setEnabled('twitch', { sevenTv: true, bttv: false })

    await emotes.load({ platform: 'twitch', channelId: '123' })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'sevenTvEmote')?.provider).toBe(
      '7tv'
    )
    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'bttvEmote')).toBeUndefined()
  })

  // 7TV calls YouTube "google", not "youtube" — the binding this app actually builds for a
  // YouTube channel carries platform: 'google'. setEnabled is called with the app's own
  // 'youtube', so the map between the two has to be right or the toggle silently does
  // nothing.
  it('maps the app platform "youtube" onto the 7TV binding platform "google"', async () => {
    fetchOptionalJson.mockImplementation((url: string) => {
      if (url.includes('7tv.io') && url.includes('/users/')) {
        return Promise.resolve({
          emote_set: {
            emotes: [
              { name: 'ytEmote', data: { host: { url: '//cdn/7tv', files: [{ name: '1x.webp' }] } } }
            ]
          }
        })
      }
      return Promise.resolve({ emotes: [] })
    })

    const emotes = new ThirdPartyEmotes()
    emotes.setEnabled('youtube', { sevenTv: false, bttv: true })

    await emotes.load({ platform: 'google', channelId: 'UC123' })

    expect(emotes.lookup({ platform: 'google', channelId: 'UC123' }, 'ytEmote')).toBeUndefined()
  })

  it('still fetches a disabled provider, so re-enabling it later needs no reconnect', async () => {
    twitchResponses()
    const emotes = new ThirdPartyEmotes()
    emotes.setEnabled('twitch', { sevenTv: false, bttv: false })

    await emotes.load({ platform: 'twitch', channelId: '123' })

    const calledSeventv = fetchOptionalJson.mock.calls.some(([url]) =>
      String(url).includes('7tv.io')
    )
    const calledBttv = fetchOptionalJson.mock.calls.some(([url]) =>
      String(url).includes('betterttv.net')
    )

    expect(calledSeventv).toBe(true)
    expect(calledBttv).toBe(true)

    emotes.setEnabled('twitch', { sevenTv: true, bttv: true })

    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'sevenTvEmote')?.provider).toBe(
      '7tv'
    )
    expect(emotes.lookup({ platform: 'twitch', channelId: '123' }, 'bttvEmote')?.provider).toBe(
      'bttv'
    )
  })
})
