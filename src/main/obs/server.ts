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

const KEEPALIVE_MS = 30000

const PAGE_FILE = 'obs.html'

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
  private server: Server | null = null
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
    return this.port === 0 ? null : `http://127.0.0.1:${this.port}`
  }

  async start(): Promise<void> {
    if (this.server) return

    const server = createServer((req, res) => {
      void this.serve(req, res)
    })
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head))

    this.server = server
    this.sockets = new WebSocketServer({ noServer: true })

    const port = await this.bind(server)
    if (port === 0) {
      console.warn('[obs] no free port — chat links are unavailable this session')
      this.server = null
      this.sockets = null
      server.close()
      return
    }

    this.port = port
    this.detachSink = this.bus.addSink({ deliver: (batch) => this.fanout(batch) })
    this.keepalive = setInterval(() => this.reap(), KEEPALIVE_MS)

    console.log(`[obs] chat links on ${this.baseUrl()}`)
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

    const server = this.server
    this.server = null
    this.port = 0

    if (server) await new Promise<void>((done) => server.close(() => done()))
  }

  /** A dock can be opened before its channel is added, and a channel re-added
      after a restart gets a fresh src-N. Clients therefore bind to the URL's
      platform + key and re-resolve whenever the source list moves. */
  sourcesChanged(): void {
    for (const client of this.clients) this.rebind(client, false)
  }

  private bind(server: Server): Promise<number> {
    return new Promise((done) => {
      let candidate = OBS_PORT

      const attempt = (): void => {
        const onError = (error: NodeJS.ErrnoException): void => {
          server.off('listening', onListening)

          if (error.code !== 'EADDRINUSE' || candidate >= OBS_PORT + OBS_PORT_ATTEMPTS - 1) {
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
        server.listen(candidate, '127.0.0.1')
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
      'cache-control': 'no-cache'
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

    const allowed = [`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`]
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

  private fanout(batch: ChatBatch): void {
    for (const client of this.clients) {
      const sourceId = client.sourceId
      if (!sourceId) continue

      const messages = batch.messages.filter((message) => message.sourceId === sourceId)
      const moderation = batch.moderation.filter((event) => event.sourceId === sourceId)
      if (messages.length === 0 && moderation.length === 0) continue

      this.send(client, { type: 'batch', batch: { messages, moderation } })
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
    console.warn('[obs] dev server unreachable:', error)
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dev server unreachable')
  }
}
