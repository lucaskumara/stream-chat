import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { BroadcastState, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { config } from '../config'
import type { Destination } from './relay'
import { destinationsFor, ingestUrl, listenUrl, relayArgs, RELAY_APP, RELAY_PORT } from './relay'

/** electron-builder cannot execute a binary from inside app.asar, so the packed path
    points at the unpacked copy beside it. In dev the module resolves normally. */
function ffmpegPath(): string {
  const resolved = require('ffmpeg-static') as string

  return resolved.replace('app.asar', 'app.asar.unpacked')
}

/** OBS pushes to this, and nothing else can: a push carrying a different key lands on a
    path ffmpeg is not listening on. Kept for the life of the app so the value copied into
    OBS stays valid, and regenerated on restart because a listener that is gone has no key
    worth honouring. */
const relayKey = randomBytes(8).toString('hex')

/** ffmpeg reports a clean teardown on stderr in the same shape as a real fault — "Error
    retrieving a packet from demuxer: I/O error" is what a *finished* stream looks like
    when OBS disconnects. Only a destination refusing us is worth surfacing. */
const REAL_FAILURE =
  /connection refused|no route|unauthor|forbidden|invalid.*key|error opening|server error/i

const RESPAWN_MS = 800

/** Long enough that a listener which dies instantly, over and over, backs off instead of
    spinning — a wrong port or a busy 1935 would otherwise respawn forever. */
const MIN_HEALTHY_MS = 3_000
const MAX_BACKOFF_MS = 15_000

/** Listens whenever anything is switched on, rather than waiting to be started. OBS
    pressing Go Live is the trigger; there is no button on our side to forget. */
export class Relay {
  private process: ChildProcess | null = null
  private forwarding = false
  private live: Platform[] = []
  private failure: string | null = null
  private timer: NodeJS.Timeout | null = null
  private startedAt = 0
  private backoff = RESPAWN_MS

  constructor(private readonly onChange: () => void) {}

  state(): BroadcastState {
    return {
      status: this.process === null ? 'off' : this.forwarding ? 'forwarding' : 'waiting',
      obsServer: `rtmp://localhost:${RELAY_PORT}/${RELAY_APP}`,
      obsKey: relayKey,
      destinations: this.live,
      error: this.failure ?? undefined
    }
  }

  /** Called whenever the settings change. Brings the listener in line with them: running
      with the right destinations, or not running at all. */
  sync(): void {
    const wanted = this.wantedDestinations()

    if (wanted.length === 0) {
      this.shutdown()
      return
    }

    const same =
      this.live.length === wanted.length &&
      wanted.every((destination, at) => this.live[at] === destination.platform)

    if (this.process && same) return

    this.shutdown()
    this.backoff = RESPAWN_MS
    this.spawn(wanted)
  }

  shutdown(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    const child = this.process
    this.process = null
    this.forwarding = false
    this.live = []

    child?.kill()
    this.onChange()
  }

  private wantedDestinations(): Destination[] {
    const setup = config().all()
    const on = PLATFORMS.filter((platform) => setup[platform].forward)

    return destinationsFor(setup, on)
  }

  private spawn(destinations: Destination[]): void {
    this.failure = null
    this.live = destinations.map((destination) => destination.platform)
    this.startedAt = Date.now()

    const child = spawn(ffmpegPath(), relayArgs(destinations, listenUrl(relayKey)), {
      windowsHide: true
    })

    this.process = child
    this.forwarding = false

    /** ffmpeg says everything on stderr, warnings included, so this is the only place a
        rejected destination shows up — a bad key is a message here, not an exit code. */
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const line = chunk.trim()
      if (!line) return

      console.warn('[relay]', line)

      /** ffmpeg prints its stats line only once packets are moving, which is the earliest
          honest signal that OBS connected. */
      if (!this.forwarding && /frame=|size=/.test(line)) {
        this.forwarding = true
        this.onChange()
      }

      if (this.process === child && REAL_FAILURE.test(line)) {
        this.failure = line.slice(0, 300)
        this.onChange()
      }
    })

    child.on('error', (err) => {
      this.failure = err.message
      this.restart(child)
    })

    child.on('exit', () => this.restart(child))

    this.onChange()
  }

  /** OBS disconnecting ends the ffmpeg process, so the listener is rebuilt to wait for the
      next Go Live. A process that dies immediately backs off instead of spinning. */
  private restart(child: ChildProcess): void {
    if (this.process !== child) return

    const healthy = Date.now() - this.startedAt > MIN_HEALTHY_MS
    this.backoff = healthy ? RESPAWN_MS : Math.min(this.backoff * 2, MAX_BACKOFF_MS)

    this.process = null
    this.forwarding = false
    this.onChange()

    const wanted = this.wantedDestinations()
    if (wanted.length === 0) return

    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.process) this.spawn(wanted)
    }, this.backoff)
  }
}

export { ingestUrl }
