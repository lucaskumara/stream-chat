import { beforeEach, describe, expect, it, vi } from 'vitest'

// A load that threw used to leave its entry in the in-flight map forever, because the
// delete sat on the success path. Every later message for that channel then awaited an
// already-rejected promise instead of retrying, so one bad minute on 7TV cost that
// channel its emotes for the life of the process.

const fetchOptionalJson = vi.fn()

vi.mock('@main/emotes/fetchJson', () => ({
  fetchOptionalJson: (url: string) => fetchOptionalJson(url) as unknown
}))

const { SevenTvEmotes } = await import('@main/emotes/seventv')
const { BttvEmotes } = await import('@main/emotes/bttv')

// Braces, not a concise arrow: a hook that *returns* a mock makes vitest call it as a
// teardown, which rejects with nobody awaiting once a test sets mockRejectedValue.
beforeEach(() => {
  fetchOptionalJson.mockReset()
})

describe('SevenTvEmotes.loadChannel', () => {
  it('can be retried after a failure', async () => {
    fetchOptionalJson.mockRejectedValueOnce(new Error('network down'))

    const emotes = new SevenTvEmotes()

    await expect(emotes.loadChannel('twitch', '123')).rejects.toThrow('network down')

    fetchOptionalJson.mockResolvedValue({
      emotes: [{ name: 'GIGACHAD', data: { host: { url: '//cdn/x', files: [{ name: '1x.webp' }] } } }]
    })

    await emotes.loadChannel('twitch', '123')

    expect(emotes.lookup('twitch', '123', 'GIGACHAD')?.provider).toBe('7tv')
  })

  it('still shares one request between concurrent callers', async () => {
    fetchOptionalJson.mockResolvedValue({ emotes: [] })

    const emotes = new SevenTvEmotes()

    await Promise.all([
      emotes.loadChannel('kick', '676'),
      emotes.loadChannel('kick', '676'),
      emotes.loadChannel('kick', '676')
    ])

    // The global set plus the channel set, once each — not once per caller.
    expect(fetchOptionalJson).toHaveBeenCalledTimes(2)
  })

  it('does not refetch a channel it has already loaded', async () => {
    fetchOptionalJson.mockResolvedValue({ emotes: [] })

    const emotes = new SevenTvEmotes()

    await emotes.loadChannel('twitch', '123')
    await emotes.loadChannel('twitch', '123')

    expect(fetchOptionalJson).toHaveBeenCalledTimes(2)
  })
})

describe('BttvEmotes.loadChannel', () => {
  it('can be retried after a failure', async () => {
    fetchOptionalJson.mockRejectedValueOnce(new Error('network down'))

    const emotes = new BttvEmotes()

    await expect(emotes.loadChannel('123')).rejects.toThrow('network down')

    // BTTV's global set is a bare array; the channel call is an object of two lists.
    fetchOptionalJson.mockResolvedValueOnce([]).mockResolvedValueOnce({
      channelEmotes: [{ id: 'abc', code: 'monkaS' }],
      sharedEmotes: []
    })

    await emotes.loadChannel('123')

    expect(emotes.lookup('123', 'monkaS')?.provider).toBe('bttv')
  })
})
