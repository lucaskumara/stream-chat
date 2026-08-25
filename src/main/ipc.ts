import { ipcMain, shell } from 'electron'
import type { AddSourceRequest } from '@shared/types'
import type { SourceManager } from './sources'
import type { TwitchAuth } from './twitch/auth'
import { buildAuthState } from './twitch/state'

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
  ipcMain.handle(IPC.listSources, () => sources.list())

  ipcMain.handle(IPC.addSource, async (_e, req: unknown) => sources.add(parseAddSource(req)))

  ipcMain.handle(IPC.removeSource, async (_e, sourceId: unknown) => {
    if (typeof sourceId !== 'string') throw new Error('sourceId must be a string')
    await sources.remove(sourceId)
  })

  ipcMain.handle(IPC.setRate, (_e, sourceId: unknown, rate: unknown) => {
    if (typeof sourceId !== 'string') throw new Error('sourceId must be a string')
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      throw new Error('rate must be a finite number')
    }
    sources.setRate(sourceId, Math.min(Math.max(rate, 0), 2000))
  })

  ipcMain.handle(IPC.setEmotes, (_e, sourceId: unknown, settings: unknown) => {
    if (typeof sourceId !== 'string') throw new Error('sourceId must be a string')
    if (typeof settings !== 'object' || settings === null) {
      throw new Error('settings must be an object')
    }
    const s = settings as Record<string, unknown>
    sources.setEmoteSettings(sourceId, {
      sevenTv: s.sevenTv !== false,
      bttv: s.bttv !== false
    })
  })

  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('url must be a string')
    // Chat messages carry arbitrary user-supplied links. Only ever hand plain
    // web URLs to the OS — never file:, and never a custom protocol handler.
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error('invalid url')
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`refusing to open protocol: ${parsedUrl.protocol}`)
    }
    await shell.openExternal(parsedUrl.toString())
  })

  /* ---------------------------- Twitch auth ---------------------------- */

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

function parseAddSource(req: unknown): AddSourceRequest {
  if (typeof req !== 'object' || req === null) throw new Error('request must be an object')
  const r = req as Record<string, unknown>

  const platform = r.platform
  if (
    platform !== 'mock' &&
    platform !== 'twitch' &&
    platform !== 'youtube' &&
    platform !== 'kick'
  ) {
    throw new Error(`unknown platform: ${String(platform)}`)
  }

  const label = typeof r.label === 'string' ? r.label.slice(0, 80) : ''
  const rate =
    typeof r.rate === 'number' && Number.isFinite(r.rate)
      ? Math.min(Math.max(r.rate, 0), 2000)
      : undefined

  const identifier =
    typeof r.identifier === 'string' ? r.identifier.trim().slice(0, 100) : undefined

  if (platform !== 'mock' && !identifier) {
    throw new Error(`${platform} sources need a channel identifier`)
  }

  return { platform, label, rate, identifier }
}
