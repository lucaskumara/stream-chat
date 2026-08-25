import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { SourceState } from '@shared/types'
import { MessageBus } from './bus'
import { SourceManager } from './sources'
import { IPC, registerIpc, unregisterIpc } from './ipc'
import { TwitchAuth } from './twitch/auth'
import { BadgeCache, Helix } from './twitch/helix'
import { EventSubHub } from './twitch/eventsub'
import { IrcHub } from './twitch/irc'
import { buildAuthState } from './twitch/state'

const isDev = !app.isPackaged

const bus = new MessageBus()

let mainWindow: BrowserWindow | null = null

function broadcastSources(states: SourceState[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.sourceState, states)
  }
}

function broadcastTwitchAuth(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.twitchAuth, buildAuthState(auth))
  }
}

const auth = new TwitchAuth(broadcastTwitchAuth)
const helix = new Helix(auth)
const badges = new BadgeCache(helix)
const hub = new EventSubHub(helix, (status, error) => {
  // Surfaced through the console for now; per-source status already reflects
  // connection health in the UI.
  if (status === 'error') console.warn('[eventsub]', error)
})

const irc = new IrcHub((status, error) => {
  if (status === 'error') console.warn('[irc]', error)
})

const sources = new SourceManager(bus, broadcastSources, { auth, helix, hub, badges }, irc)

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'stream-chat',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // Chat contains arbitrary user links. Nothing opens inside the app: links go
  // to the OS browser, and in-app navigation away from the bundle is refused.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer && url.startsWith(devServer)) return
    event.preventDefault()
    void openExternalSafely(url)
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

async function openExternalSafely(url: string): Promise<void> {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      await shell.openExternal(parsed.toString())
    }
  } catch {
    /* malformed URL from chat content — ignore */
  }
}

// A second instance would race the first for the same window and, later, the
// same token store. Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.lucaskumara.streamchat')

    registerIpc(sources, auth)

    mainWindow = createWindow()
    bus.attach(mainWindow)

    // Reconnect saved Twitch channels once the renderer is listening, so the
    // first status updates are not dropped on the floor.
    mainWindow.webContents.once('did-finish-load', () => {
      broadcastTwitchAuth()
      // Saved channels reconnect whether or not the user ever signed in.
      void sources.restoreSaved()
    })

    mainWindow.on('closed', () => {
      bus.detach()
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        bus.attach(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    unregisterIpc()
    bus.detach()
    auth.cancelPolling()
    hub.shutdown()
    irc.shutdown()
    void sources.disconnectAll()
  })
}
