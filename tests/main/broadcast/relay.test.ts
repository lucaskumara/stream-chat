import { describe, expect, it } from 'vitest'
import type { PlatformSetup } from '@shared/types'
import {
  destinationArgs,
  destinationUrl,
  hasRandomAccess,
  ingestArgs,
  ingestUrl,
  isSyncedPacket,
  listenUrl,
  normalizeIngest,
  packetPid,
  programMapPid,
  videoPidFrom
} from '@main/broadcast/relay'

/** A 188-byte TS packet, optionally carrying an adaptation field whose
    random_access_indicator marks the start of a keyframe. */
function tsPacket({
  pid = 0x100,
  adaptation = false,
  randomAccess = false
}: { pid?: number; adaptation?: boolean; randomAccess?: boolean } = {}): Buffer {
  const packet = Buffer.alloc(188)

  packet[0] = 0x47
  packet[1] = (pid >> 8) & 0x1f
  packet[2] = pid & 0xff
  packet[3] = adaptation ? 0x30 : 0x10

  if (adaptation) {
    packet[4] = 183
    packet[5] = randomAccess ? 0x40 : 0x00
  }

  return packet
}

function setup(partial: Partial<PlatformSetup>): PlatformSetup {
  return {
    channel: '',
    ingestUrl: '',
    streamKey: '',
    forward: false,
    emoteProviders: { sevenTv: true, bttv: true },
    ...partial
  }
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

  // A destination is only started at a keyframe, so its parameter sets arrive in the
  // first bytes and there is nothing to wait for. A long probe here was harmful: ffmpeg
  // read while the pipe filled, then drained at 1.23x, permanently behind by however long
  // it had waited — which is what a huge stream delay looks like.
  it('probes briefly, because the stream it is handed starts on a keyframe', () => {
    expect(Number(args[args.indexOf('-analyzeduration') + 1])).toBeLessThanOrEqual(5_000_000)
    expect(Number(args[args.indexOf('-probesize') + 1])).toBeLessThanOrEqual(10_000_000)
  })

  // Without this the progress line is suppressed and nothing ever reports itself as
  // sending — a destination sat on "Connecting" through an entire live stream.
  it('forces the progress line that says it is sending', () => {
    expect(args).toContain('-stats')
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

describe('transport stream inspection', () => {
  // A destination started anywhere but a keyframe reads an incomplete access unit with no
  // SPS/PPS: ffmpeg reports "non-existing PPS 0 referenced" and either forwards corrupt
  // frames or refuses outright. Both are things a platform dropped us over.
  it('spots the packet that begins a keyframe', () => {
    expect(hasRandomAccess(tsPacket({ adaptation: true, randomAccess: true }))).toBe(true)
  })

  it('does not mistake an ordinary packet for one', () => {
    expect(hasRandomAccess(tsPacket())).toBe(false)
    expect(hasRandomAccess(tsPacket({ adaptation: true }))).toBe(false)
  })

  // An adaptation field of length zero has no flags byte to read.
  it('handles an empty adaptation field without reading past it', () => {
    const packet = tsPacket({ adaptation: true, randomAccess: true })
    packet[4] = 0

    expect(hasRandomAccess(packet)).toBe(false)
  })

  // PID 0 is the PAT. A joining destination is primed from the last one so it gets the
  // stream tables before the keyframe.
  it('reads the PID, so the PAT can be found', () => {
    expect(packetPid(tsPacket({ pid: 0 }))).toBe(0)
    expect(packetPid(tsPacket({ pid: 0x1fff }))).toBe(0x1fff)
    expect(packetPid(tsPacket({ pid: 0x100 }))).toBe(0x100)
  })

  it('recognises a whole, synced packet and rejects anything else', () => {
    expect(isSyncedPacket(tsPacket())).toBe(true)
    expect(isSyncedPacket(Buffer.alloc(188))).toBe(false)
    expect(isSyncedPacket(tsPacket().subarray(0, 100))).toBe(false)
  })
})

/** A section-carrying packet: payload unit start set, no adaptation field, a zero pointer
    byte, then the section itself. */
function sectionPacket(pid: number, section: Buffer): Buffer {
  const packet = Buffer.alloc(188, 0xff)

  packet[0] = 0x47
  packet[1] = 0x40 | ((pid >> 8) & 0x1f)
  packet[2] = pid & 0xff
  packet[3] = 0x10
  packet[4] = 0x00

  section.copy(packet, 5)
  return packet
}

function pat(programNumber: number, pmtPid: number): Buffer {
  const body = Buffer.alloc(16)

  body[0] = 0x00
  const length = 13
  body[1] = 0xb0 | ((length >> 8) & 0x0f)
  body[2] = length & 0xff
  body[8] = (programNumber >> 8) & 0xff
  body[9] = programNumber & 0xff
  body[10] = 0xe0 | ((pmtPid >> 8) & 0x1f)
  body[11] = pmtPid & 0xff

  return sectionPacket(0, body)
}

function pmt(pmtPid: number, streams: { type: number; pid: number }[]): Buffer {
  const body = Buffer.alloc(64)

  body[0] = 0x02
  const length = 13 + streams.length * 5
  body[1] = 0xb0 | ((length >> 8) & 0x0f)
  body[2] = length & 0xff
  body[10] = 0xf0
  body[11] = 0x00

  let at = 12
  for (const stream of streams) {
    body[at] = stream.type
    body[at + 1] = 0xe0 | ((stream.pid >> 8) & 0x1f)
    body[at + 2] = stream.pid & 0xff
    body[at + 3] = 0xf0
    body[at + 4] = 0x00
    at += 5
  }

  return sectionPacket(pmtPid, body)
}

describe('stream tables', () => {
  it('finds the PMT pid in a PAT', () => {
    expect(programMapPid(pat(1, 0x1000))).toBe(0x1000)
  })

  // Program number 0 is the network information table, not a program.
  it('skips program number zero', () => {
    const packet = pat(0, 0x0010)

    expect(programMapPid(packet)).toBeNull()
  })

  it('ignores a packet that is not the PAT', () => {
    expect(programMapPid(tsPacket({ pid: 0x100 }))).toBeNull()
  })

  // The whole point: audio packets carry a random access indicator too, so a keyframe
  // only counts on the video pid. Starting elsewhere fed destinations an incomplete
  // access unit — measured at 122 "non-existing PPS" errors and nothing delivered.
  it('picks the video stream out of a PMT, not the audio one', () => {
    const packet = pmt(0x1000, [
      { type: 0x0f, pid: 0x101 },
      { type: 0x1b, pid: 0x100 }
    ])

    expect(videoPidFrom(packet)).toBe(0x100)
  })

  it('accepts HEVC as video too', () => {
    expect(videoPidFrom(pmt(0x1000, [{ type: 0x24, pid: 0x200 }]))).toBe(0x200)
  })

  it('answers null when a program carries no video', () => {
    expect(videoPidFrom(pmt(0x1000, [{ type: 0x0f, pid: 0x101 }]))).toBeNull()
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
