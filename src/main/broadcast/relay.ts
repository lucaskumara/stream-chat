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

    /** ffmpeg gives up probing long before a keyframe arrives on a stream joined part way
        through, and then has no SPS to read dimensions from: "Could not find codec
        parameters ... unspecified size", followed by the FLV muxer refusing with
        "dimensions not set". The default is 5s/5MB; a 6 Mbps stream with a keyframe every
        10s needs to be able to wait longer than that. */
    '-analyzeduration',
    '30000000',
    '-probesize',
    '50000000',

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
