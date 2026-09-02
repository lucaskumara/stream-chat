import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { BroadcastState, Platform } from '@shared/types'
import { config } from '../config'
import type { Destination } from './relay'
import { destinationsFor, ingestUrl, listenUrl, relayArgs } from './relay'

/** electron-builder cannot execute a binary from inside app.asar, so the packed path
    points at the unpacked copy beside it. In dev the module resolves normally. */
function ffmpegPath(): string {
  const resolved = require('ffmpeg-static') as string

  return resolved.replace('app.asar', 'app.asar.unpacked')
}

/** OBS pushes to this, and nothing else can: a push carrying a different key lands on a
    path ffmpeg is not listening on. Regenerated per session rather than stored, since a
    relay that is not running has no key worth keeping. */
const relayKey = randomBytes(8).toString('hex')

/** ffmpeg reports a clean teardown on stderr in the same shape as a real fault — "Error
    retrieving a packet from demuxer: I/O error" is what a *finished* stream looks like
    when the connection closes. Only a destination refusing us is worth surfacing. */
const REAL_FAILURE = /connection refused|no route|unauthor|forbidden|invalid.*key|failed to open output|server error/i

export class Relay {
  private process: ChildProcess | null = null
  private live: Platform[] = []
  private failure: string | null = null
  private stopping = false

  constructor(private readonly onChange: () => void) {}

  state(): BroadcastState {
    return {
      running: this.process !== null,
      obsServer: `rtmp://localhost:1935/live`,
      obsKey: relayKey,
      ingestUrl: ingestUrl(relayKey),
      destinations: this.live,
      error: this.failure ?? undefined
    }
  }

  /** Ready means: somewhere to send it. Without a destination the relay would accept a
      push from OBS and quietly discard it, which looks exactly like working. */
  destinations(enabled: readonly Platform[]): Destination[] {
    return destinationsFor(config().all(), enabled)
  }

  start(enabled: readonly Platform[]): void {
    if (this.process) return

    const destinations = this.destinations(enabled)

    if (destinations.length === 0) {
      this.failure = 'No platform has both a stream URL and a key yet.'
      this.onChange()
      return
    }

    this.failure = null
    this.stopping = false
    this.live = destinations.map((destination) => destination.platform)

    const child = spawn(ffmpegPath(), relayArgs(destinations, listenUrl(relayKey)), {
      windowsHide: true
    })

    this.process = child

    /** ffmpeg says everything on stderr, warnings included, so this is the only place a
        rejected destination shows up — a bad key is a message here, not an exit code. */
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const line = chunk.trim()
      if (!line) return

      console.warn('[relay]', line)

      if (!this.stopping && REAL_FAILURE.test(line)) this.failure = line.slice(0, 300)
    })

    child.on('error', (err) => {
      /** Spawn itself failing — a missing binary in a broken install, most likely. */
      this.failure = err.message
      this.finish(child)
    })

    child.on('exit', () => this.finish(child))

    this.onChange()
  }

  stop(): void {
    this.stopping = true
    this.process?.kill()
  }

  private finish(child: ChildProcess): void {
    /** A superseded process must not clear the state of the one that replaced it. */
    if (this.process !== child) return

    this.process = null
    this.live = []
    this.onChange()
  }
}
