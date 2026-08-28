import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { SourceState } from '@shared/types'
import { MessageBus } from './bus'
import { SourceManager } from './sources'
import { IPC, registerIpc, unregisterIpc } from './ipc'
import { TwitchAuth } from './twitch/auth'
import { Helix } from './twitch/helix'
import { EventSubHub, IrcHub } from './chat/platforms/twitch'
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

const eventsub = new EventSubHub(helix, (status, error) => {
  if (status === 'error') console.warn('[eventsub]', error)
})

const irc = new IrcHub()

const sources = new SourceManager(bus, broadcastSources, {
  twitch: { auth, helix, eventsub, irc }
})

function frameOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform !== 'darwin') return { frame: false }

  return { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 10 } }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 720,
    minHeight: 420,
    show: false,
    ...frameOptions(),
    backgroundColor: '#141414',
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

  const reportMaximized = (): void => {
    window.webContents.send(IPC.windowMaximized, window.isMaximized())
  }

  window.on('maximize', reportMaximized)
  window.on('unmaximize', reportMaximized)

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
  }
}

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

    mainWindow.webContents.once('did-finish-load', () => {
      broadcastTwitchAuth()

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
    eventsub.shutdown()
    irc.shutdown()
    void sources.disconnectAll()
  })
}
