import { afterEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { LoopbackReceiver } from '@main/accounts/loopback'

/** A fresh high port per test: `close()` does not settle synchronously, so reusing one
    port races the previous test's teardown. */
let port = 47591

const PATH = '/callback'

let receiver: LoopbackReceiver | null = null

function open(): LoopbackReceiver {
  port += 1
  receiver = new LoopbackReceiver(port, PATH)
  return receiver
}

afterEach(() => {
  receiver?.close()
  receiver = null
})

function get(host: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host, port, path, timeout: 4000 }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`${host} never answered — the handler threw or hung`))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('LoopbackReceiver', () => {
  // The bug this pins: the request handler built its URL base from the bound host, so
  // the IPv6 listener produced `http://::1:PORT` — not a valid URL, because an IPv6
  // literal must be bracketed. Every request over ::1 threw. Windows resolves
  // `localhost` to ::1 first and Kick's redirect_uri must be `localhost`, so this was
  // the exact path every Kick sign-in took, and it hung the browser. Uncaught in main,
  // it also took down every other server in the process.
  it('answers over IPv6, which is what localhost resolves to first on Windows', async () => {
    await open().start()

    expect(await get('::1', '/anything')).toBe(404)
  })

  it('answers over IPv4 too', async () => {
    await open().start()

    expect(await get('127.0.0.1', '/anything')).toBe(404)
  })

  it('resolves with the redirect once the code arrives', async () => {
    const listener = open()
    await listener.start()

    const arrived = listener.wait(4000)

    expect(await get('127.0.0.1', `${PATH}?code=abc&state=xyz`)).toBe(200)

    const url = await arrived
    expect(url.searchParams.get('code')).toBe('abc')
    expect(url.searchParams.get('state')).toBe('xyz')
  })

  it('answers 400 when the provider redirects with an error', async () => {
    await open().start()

    expect(await get('127.0.0.1', `${PATH}?error=access_denied`)).toBe(400)
  })

  // Anything on the machine can hit this port while a sign-in is open, and one odd
  // request must not end the sign-in or reach Electron's uncaught-exception dialog.
  it('shrugs off an unrelated request and keeps serving', async () => {
    await open().start()

    expect(await get('127.0.0.1', '/favicon.ico')).toBe(404)
    expect(await get('::1', '/callback/../elsewhere')).toBe(404)
    expect(await get('127.0.0.1', `${PATH}?code=abc&state=xyz`)).toBe(200)
  })

  // A stray hit on the callback path used to settle the wait, failing the sign-in with
  // "no authorization code" while the user was still on the consent screen.
  it('ignores a callback hit that carries no grant', async () => {
    const listener = open()
    await listener.start()

    let settled = false
    void listener.wait(3000).then(
      () => {
        settled = true
      },
      () => {}
    )

    expect(await get('127.0.0.1', `${PATH}?probe=1`)).toBe(400)
    await new Promise((r) => setTimeout(r, 100))

    expect(settled).toBe(false)

    expect(await get('127.0.0.1', `${PATH}?code=abc&state=xyz`)).toBe(200)
    await new Promise((r) => setTimeout(r, 100))

    expect(settled).toBe(true)
  })

  it('reports a taken port as something a user can act on', async () => {
    await open().start()

    const second = new LoopbackReceiver(port, PATH)

    await expect(second.start()).rejects.toThrow(/using port/)
    second.close()
  })
})
