import { BrowserWindow, app, session } from 'electron'
import type { Session } from 'electron'

export interface CookieMarker {
  url: string

  /** Any one of these being present and non-empty means the session is signed in. */
  names: string[]
}

export interface LoginTarget {
  partition: string
  startUrl: string
  title: string
  marker: CookieMarker

  /** Kick collapses its header to icons on a narrow window, hiding the very button
      this window exists to reach, so the size is the target's to choose. */
  width?: number
  height?: number
}

const WIDTH = 520
const HEIGHT = 760

/** Google refuses to render its sign-in page to anything advertising itself as an
    embedded view, and Electron's default token is exactly what it looks for. Dropping
    our own product token with it keeps the string a plain Chrome UA. */
export function browserUserAgent(): string {
  return app.userAgentFallback
    .replace(/\sElectron\/\S+/, '')
    .replace(new RegExp(`\\s${escapeForRegExp(app.getName())}\\/\\S+`), '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sessionFor(target: LoginTarget): Session {
  const partition = session.fromPartition(target.partition)

  partition.setUserAgent(browserUserAgent())

  return partition
}

export async function isSignedIn(target: LoginTarget): Promise<boolean> {
  const cookies = await sessionFor(target).cookies.get({ url: target.marker.url })

  return cookies.some(
    (cookie) => target.marker.names.includes(cookie.name) && cookie.value.length > 0
  )
}

export async function forgetSession(target: LoginTarget): Promise<void> {
  const partition = sessionFor(target)

  await partition.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb'] })
}

const open = new Map<string, BrowserWindow>()

/** Resolves true once the site has set its session cookie, false if the user closes
    the window first. The window is the only place credentials are ever typed — nothing
    in this app reads a password, and the partition keeps the session after it closes. */
export function runLoginWindow(target: LoginTarget, parent: BrowserWindow | null): Promise<boolean> {
  const existing = open.get(target.partition)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return Promise.resolve(false)
  }

  const window = new BrowserWindow({
    width: target.width ?? WIDTH,
    height: target.height ?? HEIGHT,
    title: target.title,
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    backgroundColor: '#141414',
    webPreferences: {
      partition: target.partition,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  open.set(target.partition, window)

  return new Promise<boolean>((resolve) => {
    let settled = false

    const finish = (signedIn: boolean): void => {
      if (settled) return
      settled = true

      open.delete(target.partition)
      resolve(signedIn)

      if (!window.isDestroyed()) window.destroy()
    }

    const check = (): void => {
      void isSignedIn(target).then((signedIn) => {
        if (signedIn) finish(true)
      })
    }

    window.webContents.on('did-navigate', check)
    window.webContents.on('did-navigate-in-page', check)
    window.webContents.on('did-frame-finish-load', check)

    /** Sign-in flows bounce through consent and account-chooser pages that never fire a
        top-level navigation, so the cookie can land between events. */
    const poll = setInterval(check, 1000)

    window.on('closed', () => {
      clearInterval(poll)
      finish(false)
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) void window.loadURL(url)
      return { action: 'deny' }
    })

    void window.loadURL(target.startUrl, { userAgent: browserUserAgent() })
  })
}
