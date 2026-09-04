import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import type { Platform, SourceState } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { MessageBus } from './bus'
import { SourceManager } from './sources'
import { IPC, platformConfigs, registerIpc, unregisterIpc } from './ipc'
import { ObsServer } from './obs/server'
import { IrcHub } from './chat/platforms/twitch'
import { keepRendererAlive, reportChildProcessFailures } from './lifecycle'
import { log, openLogFile, setLogLevel } from './log'
import { config } from './config'
import { Relay } from './broadcast'

const isDev = !app.isPackaged

const bus = new MessageBus()

let mainWindow: BrowserWindow | null = null

function broadcastSources(states: SourceState[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.sourceState, states)
  }

  obs.sourcesChanged()
}

function broadcastPlatforms(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.platformState, platformConfigs())
  }
}

/** The app opens one chat per platform, and which one comes from the settings screen.
    Every save is therefore also a source change. This is the only place a source is
    created. Single-flighted, because saves arrive in bursts as fields are edited. */
let syncing: Promise<void> | null = null

function syncChannels(): Promise<void> {
  syncing ??= runSync().finally(() => {
    syncing = null
  })

  return syncing
}

async function runSync(): Promise<void> {
  const setup = config().all()

  for (const platform of PLATFORMS) {
    const channel = setup[platform].channel

    if (channel) await sources.ensureOnly(platform, channel)
    else await sources.removeByPlatform(platform)
  }
}

/** A platform's chat can't tell on its own the instant its stream reaches that platform —
    YouTube in particular only notices by re-resolving, on a multi-minute offline timer.
    This app already knows the moment sooner than any chat watcher can, because it owns
    the relay: the false→true edge on a destination's own `sending` state is that signal,
    so it jumps that platform's chat straight past its backoff. Tracked here rather than
    inside `Relay`, which stays video-only and unaware `sources` exists at all. */
const sendingPlatforms = new Set<Platform>()

function broadcastRelay(): void {
  const state = relay.state()

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.broadcastState, state)
  }

  for (const destination of state.destinations) {
    const nowSending = destination.state === 'sending'

    if (nowSending && !sendingPlatforms.has(destination.platform)) {
      sources.recheckPlatform(destination.platform)
    }

    if (nowSending) sendingPlatforms.add(destination.platform)
    else sendingPlatforms.delete(destination.platform)
  }
}

const relay = new Relay(broadcastRelay)

async function platformsChanged(): Promise<void> {
  broadcastPlatforms()
  relay.sync()
  await syncChannels()
}



const irc = new IrcHub()

const sources = new SourceManager(bus, broadcastSources, {
  twitch: { irc }
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

    /** A packaged build has no console at all, so without a file there is nothing to
        read after a failure — and the one bug that only ever appeared packaged is
        exactly the kind this is for. Dev keeps the console it always had, plus the
        file, and turns the level down so ffmpeg's progress lines are visible. */
    openLogFile(app.getPath('userData'))
    setLogLevel(isDev ? 'debug' : 'info')

    log('app').info(`stream-chat ${app.getVersion()} starting (${process.platform})`)

    reportChildProcessFailures()

    registerIpc(sources, obs, bus, relay, platformsChanged)

    void obs.start()

    mainWindow = createWindow()
    bus.attach(mainWindow)

    mainWindow.webContents.once('did-finish-load', () => {
      broadcastPlatforms()
      relay.start()

      void syncChannels()
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

  /** Teardown has to finish before the process goes, or a destination is orphaned and
      the platform is left staring at a dead RTMP socket. `before-quit` is cancelled once
      and re-issued after the asynchronous half settles. */
  let quitting = false

  app.on('before-quit', (event) => {
    if (quitting) return

    quitting = true
    event.preventDefault()

    relay.shutdown()
    unregisterIpc()
    bus.detach()
    irc.shutdown()

    void Promise.all([obs.stop(), sources.disconnectAll()])
      .catch((error: unknown) => log('app').warn('shutdown:', error))
      .finally(() => app.quit())
  })
}
