import { createServer } from 'node:http'
import type { Server } from 'node:http'

const PAGE = (heading: string, body: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${heading}</title>` +
  '<style>body{font:15px system-ui;background:#141414;color:#e8e8e8;display:grid;' +
  'place-items:center;height:100vh;margin:0}div{text-align:center;max-width:32rem}' +
  'p{color:#9a9a9a}</style>' +
  `<div><h1>${heading}</h1><p>${body}</p></div>`

const OK = PAGE('Connected', 'You can close this tab and go back to stream-chat.')
const BAD = PAGE('Sign-in failed', 'Go back to stream-chat and try again.')

/** One redirect, then gone. Google wants a `127.0.0.1` loopback and Kick wants
    `localhost` — the same port either way, but Windows resolves `localhost` to `::1`
    first, so an IPv4-only listener would simply miss Kick's callback. Both families are
    bound for the same reason `ObsServer` binds both. */
export class LoopbackReceiver {
  private servers: Server[] = []
  private settle: ((url: URL) => void) | null = null

  private readonly arrived = new Promise<URL>((resolve) => {
    this.settle = resolve
  })

  constructor(
    private readonly port: number,
    private readonly path: string
  ) {}

  redirectUri(host: 'localhost' | '127.0.0.1'): string {
    return `http://${host}:${this.port}${this.path}`
  }

  /** The port is pinned because Kick exact-matches the registered `redirect_uri` and its
      portal takes exactly one URL — Google would allow any port, but there is no use in
      the two disagreeing. So a machine already using this port cannot sign in, and that
      has to read as a diagnosis rather than as a bare EADDRINUSE. */
  async start(): Promise<void> {
    try {
      await this.listen('127.0.0.1')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code === 'EADDRINUSE') {
        throw new Error(
          `Something else on this machine is using port ${this.port}, which sign-in needs. ` +
            'Close it and try again.'
        )
      }

      throw error
    }

    try {
      await this.listen('::1')
    } catch {
      // A machine with IPv6 off keeps the IPv4 listener, which is the common case.
    }
  }

  /** Resolves with the redirect URL, or rejects once the user has plainly given up.
      Nothing here inspects the query — `readRedirect` owns that, including the state
      check, because loopback is a surface anything on the machine can reach. */
  wait(timeoutMs: number): Promise<URL> {
    return Promise.race([
      this.arrived,
      new Promise<URL>((_resolve, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for the browser')), timeoutMs)
      )
    ])
  }

  close(): void {
    for (const server of this.servers) server.close()

    this.servers = []
  }

  private listen(host: string): Promise<void> {
    const server = createServer((req, res) => {
      /** The base is thrown away — only the path and query are read — so it is a fixed
          literal rather than being built from `host`. Building it from the host produced
          `http://::1:4569` on the IPv6 listener, which is not a valid URL: an IPv6
          literal has to be bracketed. That threw on every request arriving over `::1`,
          and since Windows resolves `localhost` to `::1` first, it was *the* path the
          redirect took. Uncaught in a main-process handler, it also put the whole app
          behind Electron's error dialog, which stops every other server in the process. */
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')

        if (url.pathname !== this.path) {
          res.writeHead(404).end()
          return
        }

        /** Only a redirect actually carrying the grant ends the wait. A bare hit on
            this path — a browser prefetch, a port scanner, a curl — used to settle it
            and fail the sign-in with "no authorization code" while the user was still
            reading the consent screen. */
        const carriesGrant =
          url.searchParams.has('code') || url.searchParams.has('error')

        if (!carriesGrant) {
          res.writeHead(400).end()
          return
        }

        const failed = url.searchParams.has('error')

        res.writeHead(failed ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(failed ? BAD : OK)

        this.settle?.(url)
      } catch (err) {
        /** Nothing a stranger sends to this port may take down the app. */
        console.warn('[accounts] bad request on the sign-in callback:', err)
        res.writeHead(400).end()
      }
    })

    this.servers.push(server)

    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off('listening', onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.port, host)
    })
  }
}
