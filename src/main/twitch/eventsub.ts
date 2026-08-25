import WebSocket from 'ws'
import type { Helix } from './helix'

const DEFAULT_URL = 'wss://eventsub.wss.twitch.tv/ws'

/** Twitch sends keepalives on a timer; missing several means the socket is dead. */
const KEEPALIVE_GRACE_MS = 15_000

export interface SubscriptionRequest {
  type: string
  version: string
  condition: Record<string, string>
}

export type EventHandler = (subscriptionType: string, event: Record<string, unknown>) => void

interface Registration {
  id: string
  requests: SubscriptionRequest[]
  handler: EventHandler
  /** Twitch-side subscription ids for the current session. */
  remoteIds: string[]
}

interface WelcomeMessage {
  metadata: { message_type: string; subscription_type?: string }
  payload: {
    session?: { id: string; keepalive_timeout_seconds: number; reconnect_url?: string }
    subscription?: { type: string }
    event?: Record<string, unknown>
  }
}

type HubStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * One WebSocket shared by every Twitch channel. EventSub ties subscriptions to
 * a session id, so a reconnect invalidates all of them and they must be
 * recreated — centralising that here means a channel provider never has to
 * think about session lifecycle.
 *
 * Isolation still holds where it matters: this hub is Twitch-only, so a dropped
 * socket here cannot disturb YouTube or Kick.
 */
export class EventSubHub {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private registrations = new Map<string, Registration>()
  private keepaliveTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private status: HubStatus = 'idle'
  private closing = false
  private keepaliveSeconds = 10

  constructor(
    private helix: Helix,
    private onStatus: (status: HubStatus, error?: string) => void
  ) {}

  /** Adds a channel's subscriptions. Connects the socket on first use. */
  async register(
    id: string,
    requests: SubscriptionRequest[],
    handler: EventHandler
  ): Promise<void> {
    this.registrations.set(id, { id, requests, handler, remoteIds: [] })

    if (!this.ws) {
      await this.connect()
      return // connect() subscribes everything once the welcome arrives
    }
    if (this.sessionId) await this.subscribeFor(this.registrations.get(id) as Registration)
  }

  async unregister(id: string): Promise<void> {
    const reg = this.registrations.get(id)
    if (!reg) return
    this.registrations.delete(id)

    await Promise.all(
      reg.remoteIds.map((rid) =>
        this.helix.deleteEventSubSubscription(rid).catch(() => undefined)
      )
    )

    // Nothing left to listen for — drop the socket rather than idle on it.
    if (this.registrations.size === 0) this.shutdown()
  }

  private setStatus(status: HubStatus, error?: string): void {
    this.status = status
    this.onStatus(status, error)
  }

  private connect(url = DEFAULT_URL): Promise<void> {
    return new Promise((resolve) => {
      this.closing = false
      this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

      const ws = new WebSocket(url)
      this.ws = ws

      ws.on('message', (raw: WebSocket.RawData) => {
        if (this.ws !== ws) return
        void this.onMessage(raw.toString(), resolve)
      })

      ws.on('error', (err: Error) => {
        if (this.ws !== ws) return
        this.setStatus('error', err.message)
      })

      ws.on('close', () => {
        // A superseded socket (session_reconnect handed us a new one) must not
        // trigger reconnect logic on its way out.
        if (this.ws !== ws) return
        this.clearKeepalive()
        if (this.closing) return
        this.scheduleReconnect()
        resolve()
      })
    })
  }

  private async onMessage(raw: string, resolveConnect: () => void): Promise<void> {
    let msg: WelcomeMessage
    try {
      msg = JSON.parse(raw) as WelcomeMessage
    } catch {
      return
    }

    const type = msg.metadata?.message_type
    const negotiated = msg.payload?.session?.keepalive_timeout_seconds
    if (typeof negotiated === 'number' && negotiated > 0) this.keepaliveSeconds = negotiated
    this.armKeepalive()

    switch (type) {
      case 'session_welcome': {
        const session = msg.payload.session
        if (!session) return
        this.sessionId = session.id
        this.reconnectAttempt = 0
        this.setStatus('connected')
        await this.subscribeAll()
        resolveConnect()
        return
      }

      case 'session_keepalive':
        return

      case 'notification': {
        const subType = msg.payload.subscription?.type
        const event = msg.payload.event
        if (!subType || !event) return
        // Fan out to whichever channel registered for this broadcaster.
        for (const reg of this.registrations.values()) {
          if (reg.requests.some((r) => r.type === subType)) {
            const broadcaster = event['broadcaster_user_id']
            const wanted = reg.requests.find((r) => r.type === subType)?.condition[
              'broadcaster_user_id'
            ]
            if (!wanted || wanted === broadcaster) reg.handler(subType, event)
          }
        }
        return
      }

      case 'session_reconnect': {
        // Twitch is asking us to move; the old socket stays valid until we do.
        const nextUrl = msg.payload.session?.reconnect_url
        if (!nextUrl) return
        const old = this.ws
        await this.connect(nextUrl)
        old?.close()
        return
      }

      case 'revocation': {
        this.setStatus('error', 'Twitch revoked a subscription (token or permission changed).')
        return
      }
    }
  }

  private armKeepalive(): void {
    this.clearKeepalive()
    const ms = this.keepaliveSeconds * 1000 + KEEPALIVE_GRACE_MS
    this.keepaliveTimer = setTimeout(() => {
      // Silence past the keepalive window means the socket is gone even though
      // no close frame arrived — a common failure on flaky connections.
      this.ws?.terminate()
    }, ms)
  }

  private clearKeepalive(): void {
    if (this.keepaliveTimer) clearTimeout(this.keepaliveTimer)
    this.keepaliveTimer = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.registrations.size === 0) return

    this.reconnectAttempt++
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5))
    const jitter = Math.round(Math.random() * 500)

    this.setStatus('reconnecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.sessionId = null
      void this.connect()
    }, delay + jitter)
  }

  private async subscribeAll(): Promise<void> {
    for (const reg of this.registrations.values()) {
      await this.subscribeFor(reg)
    }
  }

  private async subscribeFor(reg: Registration): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId) return

    // A reconnect invalidated the previous ids; Twitch drops them server-side.
    reg.remoteIds = []

    for (const req of reg.requests) {
      try {
        const id = await this.helix.createEventSubSubscription(
          req.type,
          req.version,
          req.condition,
          sessionId
        )
        reg.remoteIds.push(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // One failed subscription (e.g. a scope gap) should not sink the rest.
        console.warn(`[eventsub] ${req.type} failed:`, message)
        this.setStatus('error', `${req.type}: ${message}`)
      }
    }
  }

  shutdown(): void {
    this.closing = true
    this.clearKeepalive()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.ws?.close()
    this.ws = null
    this.sessionId = null
    this.setStatus('idle')
  }

  getStatus(): HubStatus {
    return this.status
  }
}
