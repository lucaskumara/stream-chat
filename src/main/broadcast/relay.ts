import type { Platform, PlatformSetup } from '@shared/types'
import { PLATFORMS } from '@shared/types'

/** OBS pushes here. 1935 is RTMP's registered port, which is what OBS offers by default
    and what anyone copying a server address expects to see. */
export const RELAY_PORT = 1935
export const RELAY_APP = 'live'

export interface Destination {
  platform: Platform
  url: string
}

/** A platform is a destination once it has somewhere to push and something to push with.
    Kick supplies both; Twitch and YouTube carry a fixed ingest, so in practice this turns
    on the moment a stream key is pasted. */
export function destinationsFor(
  setup: Record<Platform, PlatformSetup>,
  enabled: readonly Platform[]
): Destination[] {
  return PLATFORMS.filter((platform) => enabled.includes(platform))
    .map((platform) => ({ platform, url: destinationUrl(setup[platform]) }))
    .filter((destination): destination is Destination => destination.url.length > 0)
}

/** The two halves join with exactly one slash however the user pasted them — a trailing
    slash on the URL is the normal shape in Kick's dashboard and OBS accepts either. */
export function destinationUrl(setup: PlatformSetup | undefined): string {
  const base = setup?.ingestUrl.trim().replace(/\/+$/, '') ?? ''
  const key = setup?.streamKey.trim() ?? ''

  if (!base || !key) return ''

  return `${base}/${key}`
}

export function ingestUrl(relayKey: string): string {
  return `rtmp://localhost:${RELAY_PORT}/${RELAY_APP}/${relayKey}`
}

/** `-map 0` is not optional: without it ffmpeg's default stream selection hands the tee
    muxer nothing and it dies with "Output file does not contain any stream".

    `onfail=ignore` keeps one platform's failure from taking the others down. Measured:
    killing a destination mid-stream leaves the rest running to full length either way on
    ffmpeg 6.1, but the documented default is to abort, so it is set rather than assumed.

    Everything is `-c copy` — one encode, no transcode — so the relay costs almost no CPU
    and every platform receives byte-identical video. The price is that OBS's single
    encode has to satisfy the strictest destination. */
export function relayArgs(destinations: Destination[], listenUrl: string): string[] {
  const tee = destinations
    .map((destination) => `[f=flv:onfail=ignore]${destination.url}`)
    .join('|')

  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-listen',
    '1',
    '-i',
    listenUrl,
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'tee',
    tee
  ]
}

/** What ffmpeg listens on. The relay key is a path segment, so a push carrying the wrong
    one never reaches us — RTMP matches the whole application path. Bound to loopback so
    nothing on the network can push into it. */
export function listenUrl(relayKey: string): string {
  return `rtmp://127.0.0.1:${RELAY_PORT}/${RELAY_APP}/${relayKey}`
}
