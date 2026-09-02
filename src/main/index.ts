import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { Platform, SourceState } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { MessageBus } from './bus'
import { SourceManager } from './sources'
import { IPC, registerIpc, unregisterIpc } from './ipc'
import { ObsServer } from './obs/server'
import { TwitchAuth } from './twitch/auth'
import { Helix } from './twitch/helix'
import { EventSubHub, IrcHub } from './chat/platforms/twitch'
import { keepRendererAlive } from './lifecycle'
import { AccountManager } from './accounts'

const isDev = !app.isPackaged

const bus = new MessageBus()

let mainWindow: BrowserWindow | null = null

function broadcastSources(states: SourceState[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.sourceState, states)
  }

  obs.sourcesChanged()
}

function broadcastAccounts(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.accountState, accounts.list())
  }

  void syncOwnChannels()
}

/** The app opens one chat per platform and it is always the signed-in user's own, so
    every account change is also a source change: a sign-in opens that channel, a sign-out
    closes it. This is the only place a source is created. */
let syncing: Promise<void> | null = null

function syncOwnChannels(): Promise<void> {
  syncing ??= runSync().finally(() => {
    syncing = null
  })

  return syncing
}

/** A channel being watched instead of the account's own. Sending works into any channel —
    `broadcaster_id` is the target and `sender_id` is you — so this is how another chat gets
    read and typed into without weakening the rule that a sign-in picks the channel. */
const watching = new Map<Platform, string>()

async function watchChannel(platform: Platform, identifier: string | null): Promise<void> {
  if (identifier) watching.set(platform, identifier)
  else watching.delete(platform)

  await syncOwnChannels()
}

async function runSync(): Promise<void> {
  for (const platform of PLATFORMS) {
    const wanted = watching.get(platform) ?? accounts.ownChannel(platform)

    if (wanted) await sources.ensureOnly(platform, wanted)
    else await sources.removeByPlatform(platform)
  }
}

const auth = new TwitchAuth(broadcastAccounts)
const helix = new Helix(auth)

const accounts = new AccountManager(auth, broadcastAccounts)

const eventsub = new EventSubHub(helix, (status, error) => {
  if (status === 'error') console.warn('[eventsub]', error)
})

const irc = new IrcHub()

const sources = new SourceManager(bus, broadcastSources, {
  twitch: { auth, helix, eventsub, irc },
  kick: { account: accounts.kick }
})

const obs = new ObsServer(
  bus,
  sources,
  join(__dirname, '../renderer'),
  isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined
)

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

  keepRendererAlive(window)

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

    registerIpc(sources, accounts, obs, bus, watchChannel)

    void obs.start()

    mainWindow = createWindow()
    bus.attach(mainWindow)

    mainWindow.webContents.once('did-finish-load', () => {
      broadcastAccounts()

      void accounts.restore().then(broadcastAccounts)
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
    void obs.stop()
    bus.detach()
    auth.cancelPolling()
    eventsub.shutdown()
    irc.shutdown()
    void sources.disconnectAll()
  })
}
