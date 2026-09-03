import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { BroadcastState, DestinationState, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { config } from '../config'
import {
  destinationArgs,
  destinationUrl,
  hasRandomAccess,
  ingestArgs,
  ingestUrl,
  isSyncedPacket,
  listenUrl,
  packetPid,
  PAT_PID,
  programMapPid,
  videoPidFrom,
  RELAY_APP,
  RELAY_PORT,
  TS_PACKET
} from './relay'

/** electron-builder cannot execute a binary from inside app.asar, so the packed path
    points at the unpacked copy beside it. In dev the module resolves normally. */
function ffmpegPath(): string {
  const resolved = require('ffmpeg-static') as string

  return resolved.replace('app.asar', 'app.asar.unpacked')
}

/** OBS pushes to this, and nothing else can: a push carrying a different key lands on a
    path ffmpeg is not listening on. Persisted, because it lives in OBS's settings — a key
    that changed each launch meant every restart silently refused the encoder with
    "Unexpected stream", which reads as the relay being broken. */
let cachedKey: string | null = null

function relayKeyValue(): string {
  cachedKey ??= config().relayKey(() => randomBytes(8).toString('hex'))

  return cachedKey
}

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

/** The tables-plus-keyframe run a new destination is primed with. Bounded so a stream
    with no PAT in sight cannot grow it without limit. */
const MAX_PRIMER_BYTES = 4 * 1024 * 1024

interface Outbound {
  process: ChildProcess
  state: DestinationState
  error?: string
  attempts: number
  retry?: NodeJS.Timeout
}

/** A platform dropping us mid-stream — Kick did this with a TLS push error — used to be
    terminal: the dead entry stayed in the map, so nothing restarted it and nothing would
    until the switch was toggled by hand. */
const DESTINATION_RETRY_MS = 2_000
const MAX_DESTINATION_RETRY_MS = 20_000

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

  /** Bytes of the ingest's output that did not divide into whole TS packets. */
  private carry: Buffer = Buffer.alloc(0)

  /** Packets since the last PAT, so a destination can be handed the stream tables and a
      keyframe together rather than being dropped into the middle of one. */
  private primer: Buffer[] = []
  private primerBytes = 0

  /** Learned from the stream's own tables. A keyframe only counts on the video PID:
      audio packets carry a random access indicator too, and joining on one of those hands
      the destination an incomplete video access unit. */
  private pmtPid: number | null = null
  private videoPid: number | null = null

  /** Wanted, but waiting for a keyframe before its process is started at all. Nothing is
      buffered for these — that is the point. */
  private waiting = new Map<Platform, string>()

  constructor(private readonly onChange: () => void) {}

  state(): BroadcastState {
    return {
      obsServer: `rtmp://localhost:${RELAY_PORT}/${RELAY_APP}`,
      obsKey: relayKeyValue(),
      listening: this.ingest !== null,
      receiving: this.receiving,
      destinations: PLATFORMS.map((platform) => ({
        platform,
        state:
          this.outbound.get(platform)?.state ??
          (this.waiting.has(platform) ? 'connecting' : 'off'),
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
      const running = this.outbound.get(platform) ?? this.waiting.has(platform)

      /** Queued rather than started: it joins on the next keyframe, which is what keeps it
          from reading a half access unit and from falling behind before it begins. */
      if (wanted && url && !running) this.waiting.set(platform, url)

      if (!wanted) {
        this.waiting.delete(platform)
        if (this.outbound.get(platform)) this.closeDestination(platform)
      }
    }

    this.onChange()
  }

  shutdown(): void {
    this.stopped = true

    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    for (const platform of [...this.outbound.keys()]) this.closeDestination(platform)

    this.waiting.clear()
    this.resetPackets()

    const child = this.ingest
    this.ingest = null
    this.receiving = false
    child?.kill()
  }

  private resetPackets(): void {
    this.carry = Buffer.alloc(0)
    this.primer = []
    this.primerBytes = 0
    this.pmtPid = null
    this.videoPid = null
  }

  /** Splits the ingest's output into whole TS packets, keeps the tables-and-keyframe run
      that a joining destination needs, and starts anything waiting the moment a keyframe
      goes past. */
  private feed(chunk: Buffer): void {
    const data = this.carry.length > 0 ? Buffer.concat([this.carry, chunk]) : chunk
    const whole = data.length - (data.length % TS_PACKET)

    this.carry = Buffer.from(data.subarray(whole))

    const packets = data.subarray(0, whole)
    let keyframeAt = -1

    for (let at = 0; at < packets.length; at += TS_PACKET) {
      const packet = packets.subarray(at, at + TS_PACKET)

      if (!isSyncedPacket(packet)) {
        /** Lost alignment: drop what is held and pick the stream up again from the next
            tables rather than priming anyone with nonsense. */
        this.resetPackets()
        return
      }

      const pid = packetPid(packet)

      if (pid === PAT_PID) {
        this.pmtPid = programMapPid(packet) ?? this.pmtPid
        this.primer = []
        this.primerBytes = 0
      } else if (pid === this.pmtPid) {
        this.videoPid = videoPidFrom(packet) ?? this.videoPid
      }

      this.primer.push(packet)
      this.primerBytes += TS_PACKET

      if (this.primerBytes > MAX_PRIMER_BYTES) {
        this.primer = []
        this.primerBytes = 0
      }

      if (
        keyframeAt < 0 &&
        this.waiting.size > 0 &&
        pid === this.videoPid &&
        hasRandomAccess(packet)
      ) {
        keyframeAt = at
      }
    }

    this.fanOut(packets)

    if (keyframeAt >= 0) this.startWaiting(packets.subarray(keyframeAt + TS_PACKET))
  }

  /** Primed with everything from the last PAT through the keyframe, then the rest of the
      chunk, so its very first bytes carry the tables and a complete access unit. */
  private startWaiting(rest: Buffer): void {
    const primer = Buffer.concat(this.primer)

    for (const [platform, url] of [...this.waiting]) {
      this.waiting.delete(platform)

      const out = this.openDestination(platform, url)
      if (!out) continue

      out.process.stdin?.write(primer, () => {})
      if (rest.length > 0) out.process.stdin?.write(rest, () => {})
    }

    this.onChange()
  }

  private openIngest(): void {
    if (this.stopped || this.ingest) return

    this.startedAt = Date.now()

    console.warn('[ingest] listening on 1935')

    const child = spawn(ffmpegPath(), ingestArgs(listenUrl(relayKeyValue())), { windowsHide: true })

    this.ingest = child

    child.stdout.on('data', (chunk: Buffer) => {
      /** The first bytes are the only honest signal that an encoder connected — the
          process starts in order to wait, so its existence says nothing. */
      if (!this.receiving) {
        this.receiving = true
        this.failure = null
        this.sync()
      }

      this.feed(chunk)
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

    /** Every restart here is a new RTMP session, which each platform sees as the stream
        ending and a new one beginning — so a loop of these is what a viewer perceives as
        the same content playing over and over. Logged with its lifetime for that reason. */
    console.warn(
      `[ingest] ended after ${((Date.now() - this.startedAt) / 1000).toFixed(1)}s` +
        `${this.receiving ? ' while receiving' : ' without ever receiving'}`
    )

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

  private openDestination(platform: Platform, url: string, attempts = 0): Outbound | null {
    console.warn(`[relay:${platform}] starting${attempts ? ` (retry ${attempts})` : ''}`)

    const child = spawn(ffmpegPath(), destinationArgs(url), { windowsHide: true })

    const out: Outbound = { process: child, state: 'connecting', attempts }
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

    child.on('exit', (code) => {
      if (this.outbound.get(platform) !== out) return

      console.warn(`[relay:${platform}] exited (code ${code ?? 'signal'})`)

      this.outbound.delete(platform)

      /** A platform that drops us should be retried rather than left dead: the failure is
          usually transient, and the switch is still on. Backs off so a rejected key does
          not reconnect forever. */
      const setup = config().all()[platform]
      if (!setup.forward || !this.receiving) {
        this.onChange()
        return
      }

      const wait = Math.min(
        DESTINATION_RETRY_MS * 2 ** out.attempts,
        MAX_DESTINATION_RETRY_MS
      )

      const pending: Outbound = {
        process: out.process,
        state: 'error',
        error: out.error ?? 'dropped — reconnecting',
        attempts: out.attempts + 1
      }

      pending.retry = setTimeout(() => {
        if (this.outbound.get(platform) !== pending) return

        this.outbound.delete(platform)

        const url = destinationUrl(config().all()[platform])
        if (url && config().all()[platform].forward && this.receiving) {
          /** Re-queued rather than restarted, so the retry also joins on a keyframe. */
          this.waiting.set(platform, url)
        }

        this.onChange()
      }, wait)

      this.outbound.set(platform, pending)
      this.onChange()
    })

    this.onChange()

    return out
  }

  private closeDestination(platform: Platform, keepError = false): void {
    const out = this.outbound.get(platform)
    if (!out) return

    if (out.retry) clearTimeout(out.retry)
    if (!keepError) this.outbound.delete(platform)

    out.process.stdin?.end()
    out.process.kill()
  }
}

export { ingestUrl }
