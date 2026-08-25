import WebSocket from 'ws'
import { parseIrcLine, type IrcMessage } from './ircparse'

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443'

/** Twitch closes idle sockets; it PINGs us, but we watch for silence too. */
const SILENCE_TIMEOUT_MS = 6 * 60 * 1000

export type IrcHandler = (msg: IrcMessage) => void
export type IrcStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * Anonymous read-only connection to Twitch chat. Logging in as `justinfan<n>`
 * with no password is the long-standing way to read chat without an account,
 * which is what lets a channel be added by name with no sign-in at all.
 *
 * One socket serves every channel, the same shape as EventSubHub: joins are
 * cheap, and a reconnect re-joins everything from one place.
 */
export class IrcHub {
  private ws: WebSocket | null = null
  private channels = new Map<string, IrcHandler>()
  private reconnectTimer: NodeJS.Timeout | null = null
  private silenceTimer: NodeJS.Timeout | null = null
  private attempt = 0
  private closing = false

  constructor(private onStatus: (status: IrcStatus, error?: string) => void) {}

  async join(login: string, handler: IrcHandler): Promise<void> {
    const channel = login.toLowerCase()
    this.channels.set(channel, handler)

    if (!this.ws) {
      await this.connect()
      return // connect() joins everything once registered
    }
    if (this.ws.readyState === WebSocket.OPEN) this.send(`JOIN #${channel}`)
  }

  part(login: string): void {
    const channel = login.toLowerCase()
    if (!this.channels.delete(channel)) return
    if (this.ws?.readyState === WebSocket.OPEN) this.send(`PART #${channel}`)
    if (this.channels.size === 0) this.shutdown()
  }

  private send(line: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(line)
  }

  private connect(): Promise<void> {
    return new Promise((resolve) => {
      this.closing = false
      this.onStatus(this.attempt > 0 ? 'reconnecting' : 'connecting')

      const ws = new WebSocket(IRC_URL)
      this.ws = ws

      ws.on('open', () => {
        if (this.ws !== ws) return
        // Tags carry colour, badges, emote positions and message ids; commands
        // carry CLEARCHAT / CLEARMSG, which message hiding depends on.
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
        ws.send(`NICK justinfan${Math.floor(Math.random() * 80000 + 1000)}`)
        for (const channel of this.channels.keys()) ws.send(`JOIN #${channel}`)

        this.attempt = 0
        this.onStatus('connected')
        this.armSilence()
        resolve()
      })

      ws.on('message', (raw: WebSocket.RawData) => {
        if (this.ws !== ws) return
        this.armSilence()
        for (const line of raw.toString().split('\r\n')) {
          if (line === '') continue
          const msg = parseIrcLine(line)
          if (!msg) continue

          if (msg.command === 'PING') {
            this.send(`PONG :${msg.trailing ?? 'tmi.twitch.tv'}`)
            continue
          }
          this.dispatch(msg)
        }
      })

      ws.on('error', (err: Error) => {
        if (this.ws !== ws) return
        this.onStatus('error', err.message)
      })

      ws.on('close', () => {
        if (this.ws !== ws) return
        this.clearSilence()
        if (this.closing) return
        this.scheduleReconnect()
        resolve()
      })
    })
  }

  private dispatch(msg: IrcMessage): void {
    // Channel name is the first parameter for the commands we care about.
    const target = msg.params[0]
    if (!target || !target.startsWith('#')) return
    this.channels.get(target.slice(1))?.(msg)
  }

  private armSilence(): void {
    this.clearSilence()
    this.silenceTimer = setTimeout(() => this.ws?.terminate(), SILENCE_TIMEOUT_MS)
  }

  private clearSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = null
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.channels.size === 0) return
    this.attempt++
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5))
    this.onStatus('reconnecting')
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null
        void this.connect()
      },
      delay + Math.round(Math.random() * 500)
    )
  }

  shutdown(): void {
    this.closing = true
    this.clearSilence()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.ws?.close()
    this.ws = null
    this.onStatus('idle')
  }
}
