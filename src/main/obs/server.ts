import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { ChatBatch, Platform, SourceState } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import {
  OBS_PORT,
  OBS_PORT_ATTEMPTS,
  OBS_SOCKET_PATH,
  obsMatchKey,
  parseObsChatPath
} from '@shared/obs'
import type { ObsFrame } from '@shared/obs'
import type { MessageBus } from '../bus'
import type { SourceManager } from '../sources'
import { log } from '../log'

const KEEPALIVE_MS = 30000

const PAGE_FILE = 'obs.html'

const IPV4_LOOPBACK = '127.0.0.1'
const IPV6_LOOPBACK = '::1'

/** What the copied link says. Both loopback addresses are bound, so this is a
    spelling choice rather than a routing one — and it is the spelling OBS shows
    back to the user in its dock list. */
const LINK_HOST = 'localhost'

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

interface Client {
  socket: WebSocket
  platform: Platform
  key: string
  sourceId: string | null
  state: SourceState | null
  alive: boolean
}

export class ObsServer {
  private servers: Server[] = []
  private sockets: WebSocketServer | null = null
  private clients = new Set<Client>()
  private keepalive: NodeJS.Timeout | null = null
  private detachSink: (() => void) | null = null
  private port = 0

  constructor(
    private bus: MessageBus,
    private sources: SourceManager,
    private rendererDir: string,
    private devServerUrl?: string
  ) {}

  baseUrl(): string | null {
    return this.port === 0 ? null : `http://${LINK_HOST}:${this.port}`
  }

  async start(): Promise<void> {
    if (this.servers.length > 0) return

    this.sockets = new WebSocketServer({ noServer: true })

    const ipv4 = this.createServer()
    const port = await this.bind(ipv4, IPV4_LOOPBACK, 0)

    if (port === 0) {
      log('obs').warn('no free port — chat links are unavailable this session')
      this.sockets = null
      ipv4.close()
      return
    }

    this.port = port
    this.servers.push(ipv4)

    // localhost resolves to ::1 first on Windows, so an IPv4-only listener costs
    // every connection a failed attempt before it falls back — measured at 219ms
    // against 13ms. Best-effort: IPv4 is what the port scan settled, and a machine
    // with IPv6 disabled simply keeps the fallback it already had.
    const ipv6 = this.createServer()
    if (await this.bind(ipv6, IPV6_LOOPBACK, port)) this.servers.push(ipv6)
    else ipv6.close()

    this.detachSink = this.bus.addSink({ deliver: (batch) => this.fanout(batch) })
    this.keepalive = setInterval(() => this.reap(), KEEPALIVE_MS)

    log('obs').info(`chat links on ${this.baseUrl()}`)
  }

  private createServer(): Server {
    const server = createServer((req, res) => {
      void this.serve(req, res)
    })
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head))

    return server
  }

  async stop(): Promise<void> {
    if (this.keepalive) {
      clearInterval(this.keepalive)
      this.keepalive = null
    }

    this.detachSink?.()
    this.detachSink = null

    for (const client of this.clients) client.socket.terminate()
    this.clients.clear()

    this.sockets?.close()
    this.sockets = null

    const servers = this.servers
    this.servers = []
    this.port = 0

    await Promise.all(
      servers.map((server) => new Promise<void>((done) => server.close(() => done())))
    )
  }

  /** A dock can be opened before its channel is added, and a channel re-added
      after a restart gets a fresh src-N. Clients therefore bind to the URL's
      platform + key and re-resolve whenever the source list moves. */
  sourcesChanged(): void {
    for (const client of this.clients) this.rebind(client, false)
  }

  /** `fixed` of 0 scans OBS_PORT upward; anything else demands that one port, which
      is how the second family joins the port the first one settled on. */
  private bind(server: Server, host: string, fixed: number): Promise<number> {
    return new Promise((done) => {
      let candidate = fixed === 0 ? OBS_PORT : fixed

      const attempt = (): void => {
        const onError = (error: NodeJS.ErrnoException): void => {
          server.off('listening', onListening)

          const exhausted = candidate >= OBS_PORT + OBS_PORT_ATTEMPTS - 1
          if (fixed !== 0 || error.code !== 'EADDRINUSE' || exhausted) {
            done(0)
            return
          }

          candidate++
          attempt()
        }

        const onListening = (): void => {
          server.off('error', onError)
          done(candidate)
        }

        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(candidate, host)
      }

      attempt()
    })
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
    const wanted = parseObsChatPath(url.pathname) ? `/${PAGE_FILE}` : url.pathname

    if (this.devServerUrl) {
      await proxy(`${this.devServerUrl}${wanted}${url.search}`, res)
      return
    }

    const asset = assetName(wanted)
    if (!asset) {
      notFound(res)
      return
    }

    this.sendFile(asset, res)
  }

  private sendFile(name: string, res: ServerResponse): void {
    const full = resolve(this.rendererDir, name)
    const root = resolve(this.rendererDir)

    const inside = full === root || full.startsWith(root + sep)
    if (!inside || !existsSync(full) || !statSync(full).isFile()) {
      notFound(res)
      return
    }

    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',

      /** The dock page is a browser context on loopback serving files off disk. Nothing
          here should ever be sniffed into a different type than the extension says. */
      'x-content-type-options': 'nosniff'
    })
    createReadStream(full).pipe(res)
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)

    const platform = PLATFORMS.find((candidate) => candidate === url.searchParams.get('platform'))
    const key = obsMatchKey(url.searchParams.get('channel') ?? '')

    const allowed =
      url.pathname === OBS_SOCKET_PATH &&
      platform !== undefined &&
      key !== '' &&
      this.allowedOrigin(req.headers.origin)

    if (!allowed || !this.sockets) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    this.sockets.handleUpgrade(req, socket, head, (ws) => this.accept(ws, platform, key))
  }

  /** A WebSocket handshake is not subject to CORS, so any page the user happens to
      have open could otherwise read their chat off loopback. Browsers cannot forge
      Origin; a local process sends none, which is the case this deliberately allows. */
  private allowedOrigin(origin?: string): boolean {
    if (!origin) return true

    const allowed = [
      `http://${IPV4_LOOPBACK}:${this.port}`,
      `http://[${IPV6_LOOPBACK}]:${this.port}`,
      `http://${LINK_HOST}:${this.port}`
    ]
    if (this.devServerUrl) allowed.push(new URL(this.devServerUrl).origin)

    return allowed.includes(origin)
  }

  private accept(socket: WebSocket, platform: Platform, key: string): void {
    const client: Client = { socket, platform, key, sourceId: null, state: null, alive: true }
    this.clients.add(client)

    socket.on('pong', () => {
      client.alive = true
    })
    socket.on('close', () => this.clients.delete(client))
    socket.on('error', () => {
      this.clients.delete(client)
      socket.terminate()
    })

    this.rebind(client, true)
  }

  private rebind(client: Client, force: boolean): void {
    const source = this.sources.findByKey(client.platform, client.key)
    const sourceId = source?.id ?? null

    if (force || sourceId !== client.sourceId) {
      client.sourceId = sourceId
      client.state = source

      this.send(client, {
        type: 'sync',
        source,
        messages: sourceId ? this.bus.backlog.history(sourceId) : []
      })
      return
    }

    if (!source) return
    if (source.status === client.state?.status && source.label === client.state?.label) return

    client.state = source
    this.send(client, { type: 'status', source })
  }

  /** Split once per batch rather than once per client. Every dock scanned the whole
      batch for itself, so the work was clients x messages on a path that runs ten times
      a second — and the docks most likely to be open are the busy ones. */
  private fanout(batch: ChatBatch): void {
    if (this.clients.size === 0) return

    const messages = groupBySource(batch.messages)
    const moderation = groupBySource(batch.moderation)

    for (const client of this.clients) {
      const sourceId = client.sourceId
      if (!sourceId) continue

      const mine = messages.get(sourceId) ?? []
      const events = moderation.get(sourceId) ?? []
      if (mine.length === 0 && events.length === 0) continue

      this.send(client, { type: 'batch', batch: { messages: mine, moderation: events } })
    }
  }

  private send(client: Client, frame: ObsFrame): void {
    if (client.socket.readyState !== client.socket.OPEN) return

    client.socket.send(JSON.stringify(frame))
  }

  private reap(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        this.clients.delete(client)
        client.socket.terminate()
        continue
      }

      client.alive = false
      client.socket.ping()
    }
  }
}

/** Renderer assets are emitted with a relative base so the main window can load
    over file://, which means the dock page at /chat/twitch/xqc asks for
    /chat/twitch/assets/x.js. Everything vite emits lives under assets/, so the
    last such segment is the real name. */
function assetName(pathname: string): string | null {
  const at = pathname.lastIndexOf('/assets/')
  const name = at === -1 ? pathname.replace(/^\/+/, '') : pathname.slice(at + 1)

  return name === '' || name.includes('..') ? null : name
}

function groupBySource<T extends { sourceId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()

  for (const item of items) {
    const held = grouped.get(item.sourceId)

    if (held) held.push(item)
    else grouped.set(item.sourceId, [item])
  }

  return grouped
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

async function proxy(target: string, res: ServerResponse): Promise<void> {
  try {
    const upstream = await fetch(target)
    const body = Buffer.from(await upstream.arrayBuffer())
    const type = upstream.headers.get('content-type')

    res.writeHead(upstream.status, type ? { 'content-type': type } : {})
    res.end(body)
  } catch (error) {
    log('obs').warn('dev server unreachable:', error)
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dev server unreachable')
  }
}
