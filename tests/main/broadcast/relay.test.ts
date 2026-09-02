import { describe, expect, it } from 'vitest'
import type { Platform, PlatformSetup } from '@shared/types'
import {
  destinationsFor,
  destinationUrl,
  ingestUrl,
  listenUrl,
  normalizeIngest,
  relayArgs
} from '@main/broadcast/relay'

function setup(partial: Partial<PlatformSetup>): PlatformSetup {
  return { channel: '', ingestUrl: '', streamKey: '', forward: false, ...partial }
}

const ALL: Record<Platform, PlatformSetup> = {
  twitch: setup({ ingestUrl: 'rtmps://ingest.example/app/', streamKey: 'live_1_abc' }),
  youtube: setup({ ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'yt-key' }),
  kick: setup({ ingestUrl: 'rtmps://hash.contribute.example/app/', streamKey: 'sk_1' })
}

describe('normalizeIngest', () => {
  // Kick's dashboard gives a bare host and expects the encoder to append /app. Without
  // it the connection is refused with an I/O error that names no cause — this cost a
  // live debugging session.
  it('appends /app to a Kick host that carries no path', () => {
    expect(normalizeIngest('rtmps://hash.global-contribute.live-video.net:443')).toBe(
      'rtmps://hash.global-contribute.live-video.net:443/app'
    )
  })

  it('appends it through a trailing slash too', () => {
    expect(normalizeIngest('rtmps://hash.live-video.net/')).toBe('rtmps://hash.live-video.net/app')
  })

  it('leaves a URL that already has a path alone', () => {
    expect(normalizeIngest('rtmps://ingest.example/app/')).toBe('rtmps://ingest.example/app')
    expect(normalizeIngest('rtmp://a.rtmp.youtube.com/live2')).toBe(
      'rtmp://a.rtmp.youtube.com/live2'
    )
  })

  it('does not invent a path for an empty value', () => {
    expect(normalizeIngest('')).toBe('')
    expect(normalizeIngest('   ')).toBe('')
  })
})

describe('destinationUrl', () => {
  // Kick's dashboard gives a URL with a trailing slash and OBS accepts either shape, so
  // the join must not depend on which the user pasted.
  it('joins with exactly one slash however the URL was pasted', () => {
    expect(destinationUrl(setup({ ingestUrl: 'rtmp://x/app', streamKey: 'k' }))).toBe(
      'rtmp://x/app/k'
    )
    expect(destinationUrl(setup({ ingestUrl: 'rtmp://x/app/', streamKey: 'k' }))).toBe(
      'rtmp://x/app/k'
    )
    expect(destinationUrl(setup({ ingestUrl: 'rtmp://x/app///', streamKey: 'k' }))).toBe(
      'rtmp://x/app/k'
    )
  })

  it('trims whitespace dragged in with a paste', () => {
    expect(destinationUrl(setup({ ingestUrl: '  rtmp://x/app  ', streamKey: '  k  ' }))).toBe(
      'rtmp://x/app/k'
    )
  })

  it('is empty without both halves', () => {
    expect(destinationUrl(setup({ ingestUrl: 'rtmp://x/app' }))).toBe('')
    expect(destinationUrl(setup({ streamKey: 'k' }))).toBe('')
    expect(destinationUrl(undefined)).toBe('')
  })
})

describe('destinationsFor', () => {
  it('takes only the platforms that were chosen', () => {
    const chosen = destinationsFor(ALL, ['twitch', 'kick'])

    expect(chosen.map((d) => d.platform)).toEqual(['twitch', 'kick'])
  })

  // A platform with no key would otherwise become an empty destination, and ffmpeg would
  // push to a malformed URL rather than skipping it.
  it('drops a chosen platform that has no key', () => {
    const partial = { ...ALL, kick: setup({ ingestUrl: 'rtmps://hash.example/app/' }) }

    expect(destinationsFor(partial, ['twitch', 'kick']).map((d) => d.platform)).toEqual([
      'twitch'
    ])
  })

  it('is empty when nothing is chosen', () => {
    expect(destinationsFor(ALL, [])).toEqual([])
  })

  it('keeps platform order stable rather than following the chosen order', () => {
    expect(destinationsFor(ALL, ['kick', 'twitch']).map((d) => d.platform)).toEqual([
      'twitch',
      'kick'
    ])
  })
})

describe('relayArgs', () => {
  const destinations = destinationsFor(ALL, ['twitch', 'kick'])
  const args = relayArgs(destinations, listenUrl('abc123'))

  // Without -map 0 ffmpeg's default stream selection hands the tee muxer nothing and it
  // dies with "Output file does not contain any stream". Learned the hard way.
  it('maps every stream, which tee needs and default selection does not give it', () => {
    expect(args).toContain('-map')
    expect(args[args.indexOf('-map') + 1]).toBe('0')
  })

  it('copies rather than re-encoding, so the relay costs no CPU', () => {
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
  })

  it('listens rather than connecting', () => {
    expect(args[args.indexOf('-listen') + 1]).toBe('1')
  })

  // One platform refusing a key must not take the others down with it.
  it('marks every destination onfail=ignore', () => {
    const tee = args[args.length - 1]

    expect(tee.split('|')).toHaveLength(2)
    for (const part of tee.split('|')) expect(part).toContain('[f=flv:onfail=ignore]')
  })

  it('sends the joined url for each destination', () => {
    const tee = args[args.length - 1]

    expect(tee).toContain('rtmps://ingest.example/app/live_1_abc')
    expect(tee).toContain('rtmps://hash.contribute.example/app/sk_1')
  })

  it('builds a single-destination tee without a trailing separator', () => {
    const one = relayArgs(destinationsFor(ALL, ['youtube']), listenUrl('k'))

    expect(one[one.length - 1]).toBe(
      '[f=flv:onfail=ignore]rtmp://a.rtmp.youtube.com/live2/yt-key'
    )
  })
})

describe('relay addresses', () => {
  // ffmpeg binds loopback so nothing on the network can push in; OBS is told localhost
  // because that is what a person expects to type.
  it('listens on loopback only', () => {
    expect(listenUrl('abc')).toBe('rtmp://127.0.0.1:1935/live/abc')
  })

  it('offers localhost to OBS, on RTMP’s registered port', () => {
    expect(ingestUrl('abc')).toBe('rtmp://localhost:1935/live/abc')
  })

  // The key is a path segment, so a push carrying the wrong one never reaches the relay.
  it('carries the relay key in the path', () => {
    expect(listenUrl('secret')).toMatch(/\/live\/secret$/)
  })
})
