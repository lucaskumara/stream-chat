import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { BroadcastState, DestinationState, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { config } from '../config'
import {
  destinationArgs,
  destinationUrl,
  ingestArgs,
  ingestUrl,
  listenUrl,
  RELAY_APP,
  RELAY_PORT
} from './relay'

/** electron-builder cannot execute a binary from inside app.asar, so the packed path
    points at the unpacked copy beside it. In dev the module resolves normally. */
function ffmpegPath(): string {
  const resolved = require('ffmpeg-static') as string

  return resolved.replace('app.asar', 'app.asar.unpacked')
}

/** OBS pushes to this, and nothing else can: a push carrying a different key lands on a
    path ffmpeg is not listening on. Regenerated per launch, since a listener that is gone
    has no key worth honouring. */
const relayKey = randomBytes(8).toString('hex')

/** ffmpeg reports a clean teardown on stderr in the same shape as a real fault — "Error
    retrieving a packet from demuxer: I/O error" is what a *finished* stream prints when
    the encoder disconnects. Only a destination refusing us is worth surfacing. */
const REAL_FAILURE =
  /connection refused|no route|unauthor|forbidden|invalid.*key|error opening|server error/i

const RESPAWN_MS = 800
const MIN_HEALTHY_MS = 3_000
const MAX_BACKOFF_MS = 15_000

/** A destination that stops draining would otherwise back the ingest up and stall every
    other platform. Past this much unwritten, that one is dropped instead. */
const MAX_PENDING_BYTES = 8 * 1024 * 1024

interface Outbound {
  process: ChildProcess
  state: DestinationState
  error?: string
}

/** Ingest and fan-out are separate processes on purpose. One ffmpeg holds OBS's connection
    and hands the stream to us as MPEG-TS; one more per platform pushes it onward. Toggling
    a platform starts or kills only its own process, so OBS never sees a disconnect — which
    is the whole reason this is not a single `tee`. */
export class Relay {
  private ingest: ChildProcess | null = null
  private receiving = false
  private outbound = new Map<Platform, Outbound>()
  private failure: string | null = null
  private timer: NodeJS.Timeout | null = null
  private startedAt = 0
  private backoff = RESPAWN_MS
  private stopped = false

  constructor(private readonly onChange: () => void) {}

  state(): BroadcastState {
    return {
      obsServer: `rtmp://localhost:${RELAY_PORT}/${RELAY_APP}`,
      obsKey: relayKey,
      listening: this.ingest !== null,
      receiving: this.receiving,
      destinations: PLATFORMS.map((platform) => ({
        platform,
        state: this.outbound.get(platform)?.state ?? 'off',
        error: this.outbound.get(platform)?.error
      })),
      error: this.failure ?? undefined
    }
  }

  /** Listens from launch, whether or not anything is switched on, so the page can report
      a signal from OBS before the user has chosen where to send it. */
  start(): void {
    this.stopped = false
    this.openIngest()
  }

  /** Called on every settings save. Only touches the per-platform processes; the ingest,
      and therefore OBS, is left alone. */
  sync(): void {
    const setup = config().all()

    for (const platform of PLATFORMS) {
      const wanted = setup[platform].forward && this.receiving
      const url = destinationUrl(setup[platform])
      const running = this.outbound.get(platform)

      if (wanted && url && !running) this.openDestination(platform, url)
      if (!wanted && running) this.closeDestination(platform)
    }

    this.onChange()
  }

  shutdown(): void {
    this.stopped = true

    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    for (const platform of [...this.outbound.keys()]) this.closeDestination(platform)

    const child = this.ingest
    this.ingest = null
    this.receiving = false
    child?.kill()
  }

  private openIngest(): void {
    if (this.stopped || this.ingest) return

    this.startedAt = Date.now()

    const child = spawn(ffmpegPath(), ingestArgs(listenUrl(relayKey)), { windowsHide: true })

    this.ingest = child

    child.stdout.on('data', (chunk: Buffer) => {
      /** The first bytes are the only honest signal that an encoder connected — the
          process starts in order to wait, so its existence says nothing. */
      if (!this.receiving) {
        this.receiving = true
        this.failure = null
        this.sync()
      }

      this.fanOut(chunk)
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (line: string) => {
      const text = line.trim()
      if (text) console.warn('[ingest]', text)
    })

    child.on('error', (err) => {
      this.failure = err.message
      this.reopenIngest(child)
    })

    child.on('exit', () => this.reopenIngest(child))

    this.onChange()
  }

  /** OBS disconnecting ends this process, so it is rebuilt to wait for the next Go Live.
      A process that dies immediately backs off rather than spinning on a busy port. */
  private reopenIngest(child: ChildProcess): void {
    if (this.ingest !== child) return

    const healthy = Date.now() - this.startedAt > MIN_HEALTHY_MS
    this.backoff = healthy ? RESPAWN_MS : Math.min(this.backoff * 2, MAX_BACKOFF_MS)

    this.ingest = null
    this.receiving = false

    for (const platform of [...this.outbound.keys()]) this.closeDestination(platform)

    this.onChange()

    if (this.stopped) return

    this.timer = setTimeout(() => {
      this.timer = null
      this.openIngest()
    }, this.backoff)
  }

  private fanOut(chunk: Buffer): void {
    for (const [platform, out] of this.outbound) {
      const stdin = out.process.stdin
      if (!stdin || stdin.destroyed) continue

      /** Never let one slow platform hold up the others: past the cap this destination is
          dropped rather than allowed to back pressure onto the ingest. */
      if (stdin.writableLength > MAX_PENDING_BYTES) {
        out.error = 'fell too far behind and was dropped'
        out.state = 'error'
        this.closeDestination(platform, true)
        this.onChange()
        continue
      }

      stdin.write(chunk, (err) => {
        if (err && out.state !== 'error') {
          out.error = err.message
          out.state = 'error'
          this.onChange()
        }
      })
    }
  }

  private openDestination(platform: Platform, url: string): void {
    const child = spawn(ffmpegPath(), destinationArgs(url), { windowsHide: true })

    const out: Outbound = { process: child, state: 'connecting' }
    this.outbound.set(platform, out)

    /** A broken pipe here is this destination ending, not a fault worth reporting — the
        unhandled 'error' would otherwise take the whole main process down. */
    child.stdin?.on('error', () => {})

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (line: string) => {
      const text = line.trim()
      if (!text) return

      console.warn(`[relay:${platform}]`, text)

      if (out.state === 'connecting' && /frame=|size=/.test(text)) {
        out.state = 'sending'
        this.onChange()
      }

      if (REAL_FAILURE.test(text)) {
        out.state = 'error'
        out.error = text.slice(0, 200)
        this.onChange()
      }
    })

    child.on('exit', () => {
      if (this.outbound.get(platform) !== out) return

      /** Exiting while it was meant to be sending is a failure the user should see; a kill
          on the way out of a toggle is not. */
      if (out.state !== 'error') this.outbound.delete(platform)

      this.onChange()
    })

    this.onChange()
  }

  private closeDestination(platform: Platform, keepError = false): void {
    const out = this.outbound.get(platform)
    if (!out) return

    if (!keepError) this.outbound.delete(platform)

    out.process.stdin?.end()
    out.process.kill()
  }
}

export { ingestUrl }
