import { ipcMain, shell } from 'electron'
import type { AddSourceRequest, Platform } from '@shared/types'
import type { SourceManager } from './sources'
import type { TwitchAuth } from './twitch/auth'
import { buildAuthState } from './twitch/state'

const MAX_LABEL_LENGTH = 80
const MAX_IDENTIFIER_LENGTH = 100

export const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  reorderSources: 'sources:reorder',
  openExternal: 'shell:open-external',

  twitchAuthState: 'twitch:auth-state',
  twitchStartLogin: 'twitch:start-login',
  twitchSignOut: 'twitch:sign-out',

  batch: 'chat:batch',
  sourceState: 'sources:state',
  twitchAuth: 'twitch:auth'
} as const

export function registerIpc(sources: SourceManager, auth: TwitchAuth): void {
  registerSourceHandlers(sources)
  registerShellHandlers()
  registerTwitchAuthHandlers(sources, auth)
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
    IPC.twitchAuthState,
    IPC.twitchStartLogin,
    IPC.twitchSignOut
  ]) {
    ipcMain.removeHandler(channel)
  }
}

const SUPPORTED_PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick']

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
  const platform = SUPPORTED_PLATFORMS.find((candidate) => candidate === value)
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
