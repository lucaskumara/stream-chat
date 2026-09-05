import { RoomSocket } from '../../socket'

const APP_KEY = '32cbd69e4b950bf97679'

const ENDPOINT =
  `wss://ws-us2.pusher.com/app/${APP_KEY}` +
  '?protocol=7&client=js&version=8.4.0-rc2&flash=false'

const FALLBACK_ACTIVITY_TIMEOUT_MS = 120_000
const PONG_DEADLINE_MS = 30_000

interface Frame {
  event: string;
  channel?: string;
  data?: string;
}

class PusherSocket extends RoomSocket {
  constructor() {
    super(ENDPOINT, FALLBACK_ACTIVITY_TIMEOUT_MS, PONG_DEADLINE_MS)
  }

  protected onOpen(): void {
    for (const room of this.joinedRooms) this.sendJoin(room)
  }

  protected onFrame(raw: string): void {
    const frame = parseFrame(raw)
    if (!frame) return

    if (frame.event === 'pusher:connection_established') {
      const payload = decodePayload(frame.data) as {
        activity_timeout?: number;
      } | null
      this.negotiateSilence(
        payload?.activity_timeout ? payload.activity_timeout * 1000 : undefined,
      )
      return
    }

    if (frame.event === 'pusher:ping') {
      this.sendKeepalive()
      return
    }

    if (frame.event.startsWith('pusher') || !frame.channel) return

    this.deliver(frame.channel, frame.event, decodePayload(frame.data))
  }

  protected sendJoin(room: string): void {
    this.emit('pusher:subscribe', { auth: '', channel: room })
  }

  protected sendLeave(room: string): void {
    this.emit('pusher:unsubscribe', { channel: room })
  }

  protected sendKeepalive(): void {
    this.emit('pusher:ping', {})
  }

  private emit(event: string, data: unknown): void {
    this.send(JSON.stringify({ event, data }))
  }
}

function parseFrame(raw: string): Frame | null {
  try {
    const frame = JSON.parse(raw) as Frame
    return typeof frame.event === 'string' ? frame : null
  } catch {
    return null
  }
}

function decodePayload(data: string | undefined): unknown {
  if (typeof data !== 'string') return data ?? null

  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

export const kickSocket = new PusherSocket()
