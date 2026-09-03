import { describe, expect, it } from 'vitest'
import type { PlatformSetup } from '@shared/types'
import {
  destinationArgs,
  destinationUrl,
  ingestArgs,
  ingestUrl,
  listenUrl,
  normalizeIngest
} from '@main/broadcast/relay'

function setup(partial: Partial<PlatformSetup>): PlatformSetup {
  return { channel: '', ingestUrl: '', streamKey: '', forward: false, ...partial }
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

  // Without both halves there is nothing to push to, and an empty string is what the
  // relay checks before starting a destination at all.
  it('is empty without both halves', () => {
    expect(destinationUrl(setup({ ingestUrl: 'rtmp://x/app' }))).toBe('')
    expect(destinationUrl(setup({ streamKey: 'k' }))).toBe('')
    expect(destinationUrl(undefined)).toBe('')
  })
})

describe('ingestArgs', () => {
  const args = ingestArgs(listenUrl('abc123'))

  it('listens rather than connecting', () => {
    expect(args[args.indexOf('-listen') + 1]).toBe('1')
    expect(args[args.indexOf('-i') + 1]).toBe('rtmp://127.0.0.1:1935/live/abc123')
  })

  // Without -map 0 ffmpeg's default stream selection hands the muxer nothing and it dies
  // with "Output file does not contain any stream". Learned the hard way.
  it('maps every stream', () => {
    expect(args[args.indexOf('-map') + 1]).toBe('0')
  })

  it('copies rather than re-encoding, so the ingest costs no CPU', () => {
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
  })

  // MPEG-TS, not FLV: a platform switched on mid-stream has to join a stream already in
  // progress, and TS repeats its PAT/PMT so a late reader can find the stream.
  it('hands the stream out as MPEG-TS on stdout', () => {
    expect(args[args.indexOf('-f') + 1]).toBe('mpegts')
    expect(args[args.length - 1]).toBe('pipe:1')
  })

  // The ingest must never push anywhere itself — that separation is what lets a platform
  // be toggled without OBS seeing a disconnect.
  it('names no destination at all', () => {
    expect(args.join(' ')).not.toMatch(/rtmps?:\/\/(?!127\.0\.0\.1)/)
  })
})

describe('destinationArgs', () => {
  const args = destinationArgs('rtmps://ingest.example/app/live_1_abc')

  // A destination switched on mid-GOP sees no keyframe until the next one, and with
  // ffmpeg's default 5s probe it gives up first: "Could not find codec parameters ...
  // unspecified size", then the FLV muxer refuses with "dimensions not set" and nothing
  // is forwarded at all. Reproduced with a 30s keyframe interval, fixed by these.
  it('probes long enough to wait for a keyframe on a stream joined mid-GOP', () => {
    expect(Number(args[args.indexOf('-analyzeduration') + 1])).toBeGreaterThanOrEqual(30_000_000)
    expect(Number(args[args.indexOf('-probesize') + 1])).toBeGreaterThanOrEqual(50_000_000)
  })

  it('reads the ingest from stdin', () => {
    expect(args[args.indexOf('-i') + 1]).toBe('pipe:0')
    expect(args[args.indexOf('-f') + 1]).toBe('mpegts')
  })

  it('pushes FLV to the platform, still without re-encoding', () => {
    expect(args[args.length - 2]).toBe('flv')
    expect(args[args.length - 1]).toBe('rtmps://ingest.example/app/live_1_abc')
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
  })

  it('maps every stream here too', () => {
    expect(args[args.indexOf('-map') + 1]).toBe('0')
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
