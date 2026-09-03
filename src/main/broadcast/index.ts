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
    other platform. This is deliberately far beyond network jitter: at 6 Mbps it is about
    40 seconds of video. An earlier 8 MB cap was roughly ten seconds, which a brief stall
    on the platform's side would cross — the destination was dropped and retried, and the
    viewer saw a disconnect that healed itself a few seconds later. */
const MAX_PENDING_BYTES = 32 * 1024 * 1024

/** And it has to stay over the cap: one spike is not a stuck destination. */
const BACKLOG_GRACE_MS = 15_000

/** Ending stdin lets ffmpeg write the trailer and close the RTMP session, so the platform
    sees the stream *end* rather than the connection disappear — the difference between a
    clean stop and a disconnect screen. It is only killed if it will not leave. */
const CLOSE_GRACE_MS = 5_000

interface Outbound {
  process: ChildProcess
  state: DestinationState
  error?: string
  attempts: number
  retry?: NodeJS.Timeout

  /** When the write backlog first went over the cap, or 0 while it is keeping up. */
  behindSince?: number
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

  /** The most recent stream tables. A joining destination is handed these and then the
      keyframe, and nothing else: priming with *every* packet since the last PAT also hands
      over partial PES fragments of the other streams, and ffmpeg rejects those outright —
      "Packet is missing PTS", then "Error submitting a packet to the muxer". */
  private lastPat: Buffer | null = null
  private lastPmt: Buffer | null = null

  /** Learned from the stream's own tables. A keyframe only counts on the video PID:
      audio packets carry a random access indicator too, and joining on one of those hands
      the destination an incomplete video access unit. */
  private pmtPid: number | null = null
  private videoPid: number | null = null

  /** Measured from the stream itself. Kick will not go live above 2s. */
  private lastKeyframeAt = 0
  private keyframeGapMs = 0

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
      keyframeSeconds: this.keyframeGapMs > 0 ? this.keyframeGapMs / 1000 : undefined,
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

    for (const platform of [...this.outbound.keys()]) {
      this.closeDestination(platform, false, true)
    }

    this.waiting.clear()
    this.resetPackets()

    const child = this.ingest
    this.ingest = null
    this.receiving = false
    child?.kill()
  }

  private resetPackets(): void {
    this.carry = Buffer.alloc(0)
    this.lastPat = null
    this.lastPmt = null
    this.pmtPid = null
    this.videoPid = null
    this.lastKeyframeAt = 0
    this.keyframeGapMs = 0
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
        this.lastPat = Buffer.from(packet)
      } else if (pid === this.pmtPid) {
        this.videoPid = videoPidFrom(packet) ?? this.videoPid
        this.lastPmt = Buffer.from(packet)
      }

      if (pid === this.videoPid && hasRandomAccess(packet)) {
        const now = Date.now()

        /** Measured rather than assumed: the encoder's setting is not something the app
            can read, and it decides whether Kick will go live at all. */
        if (this.lastKeyframeAt > 0) this.keyframeGapMs = now - this.lastKeyframeAt
        this.lastKeyframeAt = now

        if (keyframeAt < 0 && this.waiting.size > 0) keyframeAt = at
      }
    }

    this.fanOut(packets)

    /** From the keyframe packet itself, which begins a fresh PES — anything earlier is a
        fragment of one already in flight. */
    if (keyframeAt >= 0) this.startWaiting(packets.subarray(keyframeAt))
  }

  /** The tables, then the stream from a keyframe onward, so its first bytes describe the
      format and then begin a complete access unit. */
  private startWaiting(fromKeyframe: Buffer): void {
    if (!this.lastPat || !this.lastPmt) return

    const tables = Buffer.concat([this.lastPat, this.lastPmt])

    for (const [platform, url] of [...this.waiting]) {
      this.waiting.delete(platform)

      const out = this.openDestination(platform, url)
      if (!out) continue

      out.process.stdin?.write(tables, () => {})
      if (fromKeyframe.length > 0) out.process.stdin?.write(fromKeyframe, () => {})
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

      /** The measurement changes rarely, so the renderer is only told when it moves
          enough to matter — otherwise this would fire on every keyframe. */
      const before = Math.round(this.keyframeGapMs / 500)

      this.feed(chunk)

      if (Math.round(this.keyframeGapMs / 500) !== before) this.onChange()
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

      /** Never let one slow platform hold up the others — but only give up on one that
          stays behind. A momentary spike is normal and dropping on it is what made a
          healthy stream flicker. */
      if (stdin.writableLength > MAX_PENDING_BYTES) {
        out.behindSince ??= Date.now()

        if (Date.now() - out.behindSince > BACKLOG_GRACE_MS) {
          out.error = 'fell too far behind and was dropped'
          out.state = 'error'
          this.closeDestination(platform, true)
          this.onChange()
          continue
        }
      } else {
        out.behindSince = undefined
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

  /** `immediate` is for app shutdown, where waiting would leave an orphaned process
      behind. Everywhere else the platform is worth the few seconds a clean close takes. */
  private closeDestination(platform: Platform, keepError = false, immediate = false): void {
    const out = this.outbound.get(platform)
    if (!out) return

    if (out.retry) clearTimeout(out.retry)
    if (!keepError) this.outbound.delete(platform)

    endProcess(out.process, immediate)
  }
}

/** EOF on stdin is what makes ffmpeg finish properly: it writes the FLV trailer and sends
    RTMP's stream-close, so the platform ends the broadcast instead of waiting for a dead
    connection to time out. Killing it outright — which this used to do immediately after
    ending stdin, defeating the whole point — is only a fallback for one that will not go. */
function endProcess(child: ChildProcess, immediate: boolean): void {
  if (immediate) {
    child.stdin?.end()
    child.kill()
    return
  }

  child.stdin?.end()

  const forced = setTimeout(() => child.kill(), CLOSE_GRACE_MS)

  child.once('exit', () => clearTimeout(forced))
}

export { ingestUrl }
