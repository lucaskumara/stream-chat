import { ipcMain, shell } from 'electron'
import type { AddSourceRequest, EmoteSettings, Platform } from '@shared/types'
import type { SourceManager } from './sources'
import type { TwitchAuth } from './twitch/auth'
import { buildAuthState } from './twitch/state'

const MAX_MOCK_RATE = 2000
const MAX_LABEL_LENGTH = 80
const MAX_IDENTIFIER_LENGTH = 100

export const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  setRate: 'sources:set-rate',
  setEmotes: 'sources:set-emotes',
  openExternal: 'shell:open-external',

  twitchAuthState: 'twitch:auth-state',
  twitchStartLogin: 'twitch:start-login',
  twitchSignOut: 'twitch:sign-out',

  // main -> renderer
  batch: 'chat:batch',
  sourceState: 'sources:state',
  twitchAuth: 'twitch:auth'
} as const

/**
 * The renderer is untrusted by construction (it renders remote chat content),
 * so every handler validates its arguments rather than trusting the preload.
 */
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

  ipcMain.handle(IPC.setRate, (_e, sourceId: unknown, rate: unknown) => {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      throw new Error('rate must be a finite number')
    }
    sources.setRate(requireString(sourceId, 'sourceId'), clamp(rate, 0, MAX_MOCK_RATE))
  })

  ipcMain.handle(IPC.setEmotes, (_e, sourceId: unknown, settings: unknown) => {
    sources.setEmoteSettings(requireString(sourceId, 'sourceId'), parseEmoteSettings(settings))
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
    IPC.setRate,
    IPC.setEmotes,
    IPC.openExternal,
    IPC.twitchAuthState,
    IPC.twitchStartLogin,
    IPC.twitchSignOut
  ]) {
    ipcMain.removeHandler(channel)
  }
}

const SUPPORTED_PLATFORMS: Platform[] = ['mock', 'twitch', 'youtube', 'kick']

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseEmoteSettings(value: unknown): EmoteSettings {
  if (typeof value !== 'object' || value === null) {
    throw new Error('settings must be an object')
  }
  const record = value as Record<string, unknown>
  // Absent means enabled, so an older renderer cannot silently disable emotes.
  return { sevenTv: record.sevenTv !== false, bttv: record.bttv !== false }
}

/**
 * Chat messages carry arbitrary user-supplied links. Only ever hand plain web
 * URLs to the OS — never file:, and never a custom protocol handler.
 */
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
  const rate =
    typeof record.rate === 'number' && Number.isFinite(record.rate)
      ? clamp(record.rate, 0, MAX_MOCK_RATE)
      : undefined
  const identifier =
    typeof record.identifier === 'string'
      ? record.identifier.trim().slice(0, MAX_IDENTIFIER_LENGTH)
      : undefined

  if (platform !== 'mock' && !identifier) {
    throw new Error(`${platform} sources need a channel identifier`)
  }

  return { platform, label, rate, identifier }
}
