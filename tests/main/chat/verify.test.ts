import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTwitch = vi.fn()
const resolveKick = vi.fn()
const resolveYouTube = vi.fn()

vi.mock('@main/chat/platforms/twitch/channel', () => ({ resolveChannel: resolveTwitch }))
vi.mock('@main/chat/platforms/kick/channel', () => ({ resolveChannel: resolveKick }))
vi.mock('@main/chat/platforms/youtube/channel', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveChannel: resolveYouTube
}))

const { verifyChannel } = await import('@main/chat/verify')

beforeEach(() => {
  resolveTwitch.mockReset()
  resolveKick.mockReset()
  resolveYouTube.mockReset()
})

describe('verifyChannel on twitch', () => {
  // GQL resolves the properly-cased login, which is what "match the site's
  // capitalization" means for Twitch — the login itself is case-insensitive on
  // the wire, so writing the display name back is safe.
  it('reports ok with the properly-cased login', async () => {
    resolveTwitch.mockResolvedValue({
      state: 'ok',
      channel: { displayName: 'TheBurntPeanut', login: 'theburntpeanut', broadcasterId: '1' }
    })

    expect(await verifyChannel('twitch', 'theburntpeanut')).toEqual({
      ok: true,
      canonicalIdentifier: 'TheBurntPeanut'
    })
  })

  it('reports the reason when the channel is missing', async () => {
    resolveTwitch.mockResolvedValue({
      state: 'missing',
      reason: 'Twitch has no channel called "nobody".'
    })

    expect(await verifyChannel('twitch', 'nobody')).toEqual({
      ok: false,
      reason: 'Twitch has no channel called "nobody".'
    })
  })
})

describe('verifyChannel on kick', () => {
  it('reports ok with the resolved slug', async () => {
    resolveKick.mockResolvedValue({
      state: 'ok',
      channel: { displayName: 'xQc', slug: 'xqc', chatroomId: 1, userId: 2 }
    })

    expect(await verifyChannel('kick', 'xqc')).toEqual({ ok: true, canonicalIdentifier: 'xqc' })
  })

  it('reports the reason when the channel is missing', async () => {
    resolveKick.mockResolvedValue({ state: 'missing', reason: 'Kick has no channel called "x".' })

    expect(await verifyChannel('kick', 'x')).toEqual({
      ok: false,
      reason: 'Kick has no channel called "x".'
    })
  })

  // A fetch failure means we never actually confirmed anything, so there is
  // nothing to correct the field to — but per the "unreachable never blocks"
  // invariant, saving still proceeds.
  it('reports ok with no correction when kick is unreachable', async () => {
    resolveKick.mockResolvedValue({ state: 'unreachable', reason: 'socket hang up' })

    expect(await verifyChannel('kick', 'xqc')).toEqual({ ok: true, canonicalIdentifier: undefined })
  })
})

describe('verifyChannel on youtube', () => {
  it('lowercases a handle on success', async () => {
    resolveYouTube.mockResolvedValue({
      state: 'ok',
      channel: { displayName: 'Lofi Girl', videoId: 'v', continuation: 'c', channelId: 'UC1' }
    })

    expect(await verifyChannel('youtube', '@LofiGirl')).toEqual({
      ok: true,
      canonicalIdentifier: '@lofigirl'
    })
  })

  // Offline still means the channel exists, so the identifier is still worth
  // normalizing — only 'missing' should ever withhold a correction.
  it('still lowercases the handle when the channel is offline', async () => {
    resolveYouTube.mockResolvedValue({
      state: 'offline',
      reason: 'not streaming right now',
      displayName: 'Excorpse'
    })

    expect(await verifyChannel('youtube', '@Excorpse')).toEqual({
      ok: true,
      canonicalIdentifier: '@excorpse'
    })
  })

  it('leaves a channel id or video id untouched', async () => {
    resolveYouTube.mockResolvedValue({
      state: 'ok',
      channel: { displayName: 'x', videoId: 'v', continuation: 'c', channelId: 'UC1' }
    })

    expect(await verifyChannel('youtube', 'UCSJ4gkVC6NrvII8umztf0Ow')).toEqual({
      ok: true,
      canonicalIdentifier: undefined
    })
  })

  it('reports the reason when the channel is missing', async () => {
    resolveYouTube.mockResolvedValue({
      state: 'missing',
      reason: 'YouTube has no channel or video for "@nobody".'
    })

    expect(await verifyChannel('youtube', '@nobody')).toEqual({
      ok: false,
      reason: 'YouTube has no channel or video for "@nobody".'
    })
  })
})
