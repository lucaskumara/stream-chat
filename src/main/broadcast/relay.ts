import type { Platform, PlatformSetup } from '@shared/types'

/** OBS pushes here. 1935 is RTMP's registered port, which is what OBS offers by default
    and what anyone copying a server address expects to see. */
export const RELAY_PORT = 1935
export const RELAY_APP = 'live'

export interface Destination {
  platform: Platform
  url: string
}

/** Kick's dashboard hands out a host with no path — `rtmps://<hash>.global-contribute.
    live-video.net:443` — and expects the encoder to append `/app`. OBS users hit the same
    thing. Without it the connection is refused with a bare I/O error that says nothing
    about the cause, so the app appends it rather than making anyone know that.

    Twitch's already ends `/app` and YouTube's `/live2`, so this only ever fires on Kick. */
export function normalizeIngest(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  const path = trimmed.replace(/^\w+:\/\//, '')

  return path.includes('/') ? trimmed : `${trimmed}/app`
}

/** The two halves join with exactly one slash however the user pasted them — a trailing
    slash on the URL is the normal shape in Kick's dashboard and OBS accepts either. */
export function destinationUrl(setup: PlatformSetup | undefined): string {
  const base = normalizeIngest(setup?.ingestUrl ?? '')
  const key = setup?.streamKey.trim() ?? ''

  if (!base || !key) return ''

  return `${base}/${key}`
}

export function ingestUrl(relayKey: string): string {
  return `rtmp://localhost:${RELAY_PORT}/${RELAY_APP}/${relayKey}`
}

/** What ffmpeg listens on. The relay key is a path segment, so a push carrying the wrong
    one never reaches us — RTMP matches the whole application path. Bound to loopback so
    nothing on the network can push in. */
export function listenUrl(relayKey: string): string {
  return `rtmp://127.0.0.1:${RELAY_PORT}/${RELAY_APP}/${relayKey}`
}

/** Accepts OBS and hands the stream to us as MPEG-TS on stdout, rather than pushing it
    anywhere itself. That separation is the whole design: this process — and therefore
    OBS's connection — is untouched when a platform is switched on or off.

    `-map 0` is not optional; without it ffmpeg's default stream selection hands the muxer
    nothing. `-c copy` means no transcode, so the ingest costs almost no CPU.

    MPEG-TS rather than FLV because a destination that starts late has to be able to join
    a stream already in progress: TS repeats its PAT/PMT tables, so a new reader can find
    the stream without having seen its header. */
export function ingestArgs(listen: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',

    /** `-loglevel warning` suppresses the progress line, and the progress line is the only
        thing that says an encoder is actually sending. Without `-stats` the app reported
        "Connecting" forever while a stream was plainly live. */
    '-stats',

    '-listen',
    '1',
    '-i',
    listen,
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'mpegts',
    'pipe:1'
  ]
}

/** One of these per platform, fed the ingest's bytes on stdin. Killing it stops that
    platform and nothing else.

    A platform switched on mid-stream begins reading part way through a GOP, so its first
    fraction of a second is an incomplete access unit — measured at 5 bad frames out of
    834, all at the head, before the next keyframe two seconds in. `-fflags +discardcorrupt`
    does *not* help: these packets are not flagged corrupt, merely truncated. Fixing it
    properly means parsing the transport stream to start a new destination on a keyframe,
    which is not worth it for a blip at the very start of that platform's own stream. */
export function destinationArgs(url: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',

    /** Same reason as the ingest: without this the destination never reports itself as
        sending, and its row sits on "Connecting" for the whole stream. */
    '-stats',

    /** Small on purpose. A destination is only ever started at a keyframe (see
        `keyframeStart`), so the parameter sets are in the first bytes it reads and there
        is nothing to wait for. A long probe here was actively harmful: ffmpeg sat reading
        while the pipe filled, then drained the backlog at 1.23x — permanently behind by
        however long it had waited, which is what a huge stream delay looks like. */
    '-analyzeduration',
    '2000000',
    '-probesize',
    '4000000',

    '-f',
    'mpegts',
    '-i',
    'pipe:0',
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'flv',
    url
  ]
}

const TS_PACKET = 188
const TS_SYNC = 0x47
const PAT_PID = 0

/** MPEG-TS carries a `random_access_indicator` in a packet's adaptation field, which is
    set on the packet beginning a keyframe. Starting a destination anywhere else means it
    reads an incomplete access unit and has no SPS/PPS — ffmpeg then says "non-existing
    PPS 0 referenced" and either forwards corrupt frames or refuses outright. */
export function hasRandomAccess(packet: Buffer): boolean {
  const adaptation = (packet[3] >> 4) & 0b11

  if (adaptation !== 0b10 && adaptation !== 0b11) return false
  if (packet[4] === 0) return false

  return (packet[5] & 0x40) !== 0
}

export function packetPid(packet: Buffer): number {
  return ((packet[1] & 0x1f) << 8) | packet[2]
}

export function isSyncedPacket(packet: Buffer): boolean {
  return packet.length === TS_PACKET && packet[0] === TS_SYNC
}

/** The payload of a section-carrying packet, past the adaptation field and the pointer
    byte. Null when the packet does not begin a section, since a continuation cannot be
    parsed on its own and the next one along will do. */
function sectionPayload(packet: Buffer): Buffer | null {
  const startsSection = (packet[1] & 0x40) !== 0
  if (!startsSection) return null

  const adaptation = (packet[3] >> 4) & 0b11
  if (adaptation !== 0b01 && adaptation !== 0b11) return null

  let at = 4
  if (adaptation === 0b11) at += 1 + packet[4]

  const pointer = packet[at]
  at += 1 + pointer

  return at < packet.length ? packet.subarray(at) : null
}

/** The PMT's PID, read from the Program Association Table. Program number 0 is the
    network table rather than a program, so it is skipped. */
export function programMapPid(packet: Buffer): number | null {
  if (packetPid(packet) !== PAT_PID) return null

  const payload = sectionPayload(packet)
  if (!payload || payload[0] !== 0x00) return null

  const sectionLength = ((payload[1] & 0x0f) << 8) | payload[2]
  const end = Math.min(3 + sectionLength - 4, payload.length)

  for (let at = 8; at + 4 <= end; at += 4) {
    const programNumber = (payload[at] << 8) | payload[at + 1]
    if (programNumber === 0) continue

    return ((payload[at + 2] & 0x1f) << 8) | payload[at + 3]
  }

  return null
}

/** H.264 and HEVC stream types. The video PID is the one whose keyframes matter — audio
    packets also carry a random access indicator, and starting a destination on one of
    those hands it an incomplete video access unit, which is the whole bug. */
const VIDEO_STREAM_TYPES = new Set([0x1b, 0x24])

export function videoPidFrom(packet: Buffer): number | null {
  const payload = sectionPayload(packet)
  if (!payload || payload[0] !== 0x02) return null

  const sectionLength = ((payload[1] & 0x0f) << 8) | payload[2]
  const end = Math.min(3 + sectionLength - 4, payload.length)

  const programInfoLength = ((payload[10] & 0x0f) << 8) | payload[11]
  let at = 12 + programInfoLength

  while (at + 5 <= end) {
    const streamType = payload[at]
    const elementaryPid = ((payload[at + 1] & 0x1f) << 8) | payload[at + 2]
    const esInfoLength = ((payload[at + 3] & 0x0f) << 8) | payload[at + 4]

    if (VIDEO_STREAM_TYPES.has(streamType)) return elementaryPid

    at += 5 + esInfoLength
  }

  return null
}

export { TS_PACKET, PAT_PID }
