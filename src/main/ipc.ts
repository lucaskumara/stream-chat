import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import type { AddSourceRequest, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { obsChatPath } from '@shared/obs'
import type { ObsServer } from './obs/server'
import type { SourceManager } from './sources'
import type { TwitchAuth } from './twitch/auth'
import { buildAuthState } from './twitch/state'

const MAX_LABEL_LENGTH = 80
const MAX_IDENTIFIER_LENGTH = 100
const MAX_COPY_LENGTH = 2000

export const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  reorderSources: 'sources:reorder',
  openExternal: 'shell:open-external',
  copyText: 'clipboard:write',
  obsLink: 'obs:link',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximized: 'window:maximized',

  twitchAuthState: 'twitch:auth-state',
  twitchStartLogin: 'twitch:start-login',
  twitchSignOut: 'twitch:sign-out',

  batch: 'chat:batch',
  sourceState: 'sources:state',
  twitchAuth: 'twitch:auth'
} as const

export function registerIpc(sources: SourceManager, auth: TwitchAuth, obs: ObsServer): void {
  registerSourceHandlers(sources)
  registerShellHandlers()
  registerWindowHandlers()
  registerTwitchAuthHandlers(sources, auth)
  registerObsHandlers(sources, obs)
}

function registerSourceHandlers(sources: SourceManager): void {
  ipcMain.handle(IPC.listSources, () => sources.list())

  ipcMain.handle(IPC.addSource, async (_e, request: unknown) =>
    sources.add(parseAddSource(request))
  )

  ipcMain.handle(IPC.removeSource, async (_e, sourceId: unknown) => {
    await sources.remove(requireString(sourceId, 'sourceId'))
  })

  ipcMain.handle(IPC.reorderSources, (_e, orderedIds: unknown) => {
    sources.reorder(parseSourceIds(orderedIds))
  })
}

function registerShellHandlers(): void {
  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    await shell.openExternal(parseWebUrl(url))
  })

  ipcMain.handle(IPC.copyText, (_e, text: unknown) => {
    clipboard.writeText(requireString(text, 'text').slice(0, MAX_COPY_LENGTH))
  })
}

/** Main owns the port and the key spelling, so the renderer asks for a finished
    link rather than assembling one. Null means the link server never bound. */
function registerObsHandlers(sources: SourceManager, obs: ObsServer): void {
  ipcMain.handle(IPC.obsLink, (_e, sourceId: unknown) => {
    const base = obs.baseUrl()
    if (!base) return null

    const target = sources.targetOf(requireString(sourceId, 'sourceId'))
    if (!target) return null

    return `${base}${obsChatPath(target.platform, target.identifier)}`
  })
}

function registerWindowHandlers(): void {
  ipcMain.handle(IPC.windowMinimize, (event) => senderWindow(event)?.minimize())

  ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const window = senderWindow(event)
    if (!window) return

    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle(IPC.windowClose, (event) => senderWindow(event)?.close())

  ipcMain.handle(IPC.windowIsMaximized, (event) => senderWindow(event)?.isMaximized() ?? false)
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function registerTwitchAuthHandlers(sources: SourceManager, auth: TwitchAuth): void {
  ipcMain.handle(IPC.twitchAuthState, () => buildAuthState(auth))
  ipcMain.handle(IPC.twitchStartLogin, async () => auth.startDeviceFlow())
  ipcMain.handle(IPC.twitchSignOut, async () => {
    await sources.removeByPlatform('twitch')
    auth.signOut()
  })
}

export function unregisterIpc(): void {
  for (const channel of [
    IPC.listSources,
    IPC.addSource,
    IPC.removeSource,
    IPC.reorderSources,
    IPC.openExternal,
    IPC.copyText,
    IPC.obsLink,
    IPC.windowMinimize,
    IPC.windowToggleMaximize,
    IPC.windowClose,
    IPC.windowIsMaximized,
    IPC.twitchAuthState,
    IPC.twitchStartLogin,
    IPC.twitchSignOut
  ]) {
    ipcMain.removeHandler(channel)
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function parseSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('orderedIds must be an array')

  return value.map((entry, index) => requireString(entry, `orderedIds[${index}]`))
}

function parseWebUrl(value: unknown): string {
  let parsed: URL
  try {
    parsed = new URL(requireString(value, 'url'))
  } catch {
    throw new Error('invalid url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refusing to open protocol: ${parsed.protocol}`)
  }
  return parsed.toString()
}

function parsePlatform(value: unknown): Platform {
  const platform = PLATFORMS.find((candidate) => candidate === value)
  if (!platform) throw new Error(`unknown platform: ${String(value)}`)
  return platform
}

function parseAddSource(value: unknown): AddSourceRequest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('request must be an object')
  }
  const record = value as Record<string, unknown>

  const platform = parsePlatform(record.platform)
  const label = typeof record.label === 'string' ? record.label.slice(0, MAX_LABEL_LENGTH) : ''
  const identifier =
    typeof record.identifier === 'string'
      ? record.identifier.trim().slice(0, MAX_IDENTIFIER_LENGTH)
      : undefined

  if (!identifier) {
    throw new Error(`${platform} sources need a channel identifier`)
  }

  return { platform, label, identifier }
}
