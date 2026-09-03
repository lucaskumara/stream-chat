import { beforeEach, describe, expect, it, vi } from 'vitest'

// The session is cached so every poll shares one Innertube. A *rejected* one must not
// be: no network at launch is the ordinary case, and caching that failure left YouTube
// dead for the life of the process while Twitch and Kick reconnected on their own.

const create = vi.fn()

vi.mock('youtubei.js', () => ({
  Innertube: { create: (options: unknown) => create(options) as unknown },
  Parser: { setParserErrorHandler: () => {} },
  UniversalCache: class {}
}))

const { innertube } = await import('@main/chat/platforms/youtube/connection')

beforeEach(() => {
  create.mockReset()
})

describe('innertube', () => {
  it('creates the session once and shares it', async () => {
    const session = { id: 'first' }
    create.mockResolvedValue(session)

    await expect(innertube()).resolves.toBe(session)
    await expect(innertube()).resolves.toBe(session)

    expect(create).toHaveBeenCalledTimes(1)

    // Skipping the player skips the signature-cipher work, which only playback needs.
    expect(create.mock.calls[0]?.[0]).toMatchObject({ retrieve_player: false })
  })
})

describe('innertube after a failure', () => {
  it('reports the failure and then builds a fresh session on the next call', async () => {
    // A separate module instance, so the successful session from the suite above is not
    // already cached.
    vi.resetModules()
    create.mockReset()

    const { innertube: fresh } = await import('@main/chat/platforms/youtube/connection')

    create.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))

    await expect(fresh()).rejects.toThrow('ENOTFOUND')

    const recovered = { id: 'second' }
    create.mockResolvedValue(recovered)

    await expect(fresh()).resolves.toBe(recovered)
    expect(create).toHaveBeenCalledTimes(2)
  })
})
