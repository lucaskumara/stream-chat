import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import type {
  AddSourceRequest,
  EmoteProviderSettings,
  Platform,
  PlatformConfig,
  PlatformPatch
} from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { obsChatPath } from '@shared/obs'
import type { MessageBus } from './bus'
import type { ObsServer } from './obs/server'
import type { SourceManager } from './sources'
import { config } from './config'
import { logDirectory } from './log'
import type { Relay } from './broadcast'
import { verifyChannel } from './chat/verify'

const MAX_LABEL_LENGTH = 80
const MAX_IDENTIFIER_LENGTH = 100
const MAX_COPY_LENGTH = 2000

export const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  reorderSources: 'sources:reorder',
  sourceBacklog: 'sources:backlog',
  openExternal: 'shell:open-external',
  copyText: 'clipboard:write',
  obsLink: 'obs:link',
  openLogs: 'logs:open',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximized: 'window:maximized',

  platforms: 'platforms:list',
  savePlatform: 'platforms:save',
  verifyChannel: 'platforms:verify',

  broadcast: 'broadcast:state',

  batch: 'chat:batch',
  sourceState: 'sources:state',
  platformState: 'platforms:state',
  broadcastState: 'broadcast:changed'
} as const

type IpcHandler = Parameters<typeof ipcMain.handle>[1]

const registered = new Set<string>()

/** One registration list, so a handler cannot be added without also becoming
    removable — the second, hand-copied list this replaced could drift silently. */
function handle(channel: string, listener: IpcHandler): void {
  registered.add(channel)
  ipcMain.handle(channel, listener)
}

export function registerIpc(
  sources: SourceManager,
  obs: ObsServer,
  bus: MessageBus,
  relay: Relay,
  onPlatformChange: () => Promise<void>
): void {
  registerSourceHandlers(sources, bus)
  registerPlatformHandlers(onPlatformChange)
  registerBroadcastHandlers(relay)

  registerShellHandlers()
  registerWindowHandlers()
  registerObsHandlers(obs)
}

/** The stream key is write-only from the renderer's side: it can set one and be told
    whether one exists, but never read it back. */
export function platformConfigs(): PlatformConfig[] {
  const all = config().all()

  return PLATFORMS.map((platform) => ({
    platform,
    channel: all[platform].channel,
    ingestUrl: all[platform].ingestUrl,
    hasStreamKey: all[platform].streamKey.length > 0,
    forward: all[platform].forward,
    emoteProviders: all[platform].emoteProviders
  }))
}

function registerPlatformHandlers(onPlatformChange: () => Promise<void>): void {
  handle(IPC.platforms, () => platformConfigs())

  handle(IPC.savePlatform, async (_e, platform: unknown, patch: unknown) => {
    config().update(parsePlatform(platform), parsePlatformPatch(patch))

    await onPlatformChange()
  })

  handle(IPC.verifyChannel, (_e, platform: unknown, identifier: unknown) =>
    verifyChannel(parsePlatform(platform), requireString(identifier, 'identifier'))
  )
}

function registerBroadcastHandlers(relay: Relay): void {
  handle(IPC.broadcast, () => relay.state())
}

function registerSourceHandlers(sources: SourceManager, bus: MessageBus): void {
  handle(IPC.listSources, () => sources.list())

  handle(IPC.sourceBacklog, (_e, sourceId: unknown) =>
    bus.backlog.history(requireString(sourceId, 'sourceId'))
  )

  handle(IPC.addSource, async (_e, request: unknown) =>
    sources.add(parseAddSource(request))
  )

  handle(IPC.removeSource, async (_e, sourceId: unknown) => {
    await sources.remove(requireString(sourceId, 'sourceId'))
  })

  handle(IPC.reorderSources, (_e, orderedIds: unknown) => {
    sources.reorder(parseSourceIds(orderedIds))
  })

}


function registerShellHandlers(): void {
  handle(IPC.openExternal, async (_e, url: unknown) => {
    await shell.openExternal(parseWebUrl(url))
  })

  handle(IPC.copyText, (_e, text: unknown) => {
    clipboard.writeText(requireString(text, 'text').slice(0, MAX_COPY_LENGTH))
  })

  /** The directory comes from main, so the renderer cannot ask the shell to open a
      path of its own choosing — the argument here is deliberately nothing at all. */
  handle(IPC.openLogs, () => {
    const directory = logDirectory()
    if (!directory) return false

    shell.openPath(directory)
    return true
  })
}

/** Main owns the port and the key spelling, so the renderer asks for a finished
    link rather than assembling one. Null means the link server never bound. The
    link is built from platform + channel alone, not a live source: Settings ->
    Platforms asks for it straight from the saved config, whether or not that
    channel is currently connected. */
function registerObsHandlers(obs: ObsServer): void {
  handle(IPC.obsLink, (_e, platform: unknown, channel: unknown) => {
    const base = obs.baseUrl()
    if (!base) return null

    const identifier = requireString(channel, 'channel').trim()
    if (!identifier) return null

    return `${base}${obsChatPath(parsePlatform(platform), identifier)}`
  })
}

function registerWindowHandlers(): void {
  handle(IPC.windowMinimize, (event) => senderWindow(event)?.minimize())

  handle(IPC.windowToggleMaximize, (event) => {
    const window = senderWindow(event)
    if (!window) return

    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  handle(IPC.windowClose, (event) => senderWindow(event)?.close())

  handle(IPC.windowIsMaximized, (event) => senderWindow(event)?.isMaximized() ?? false)
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function unregisterIpc(): void {
  for (const channel of registered) ipcMain.removeHandler(channel)

  registered.clear()
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

export function parseSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('orderedIds must be an array')

  return value.map((entry, index) => requireString(entry, `orderedIds[${index}]`))
}

export function parseWebUrl(value: unknown): string {
  const raw = requireString(value, 'url')

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('invalid url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refusing to open protocol: ${parsed.protocol}`)
  }
  return parsed.toString()
}

export function parsePlatform(value: unknown): Platform {
  const platform = PLATFORMS.find((candidate) => candidate === value)
  if (!platform) throw new Error(`unknown platform: ${String(value)}`)
  return platform
}

const MAX_KEY_LENGTH = 500

/** Every field optional so a save can carry one of them. Strings only, and trimmed —
    a pasted stream key drags whitespace in more often than not. */
export function parsePlatformPatch(value: unknown): PlatformPatch {
  if (typeof value !== 'object' || value === null) {
    throw new Error('patch must be an object')
  }

  const record = value as Record<string, unknown>
  const patch: PlatformPatch = {}

  for (const field of ['channel', 'ingestUrl', 'streamKey'] as const) {
    if (record[field] === undefined) continue

    patch[field] = requireString(record[field], field).trim().slice(0, MAX_KEY_LENGTH)
  }

  if (record.forward !== undefined) {
    if (typeof record.forward !== 'boolean') throw new Error('forward must be a boolean')

    patch.forward = record.forward
  }

  if (record.emoteProviders !== undefined) {
    patch.emoteProviders = parseEmoteProviders(record.emoteProviders)
  }

  return patch
}

/** Always the whole pair, never a partial merge inside main — a caller that forgets one
    flag fails loudly instead of silently flipping it on. */
function parseEmoteProviders(value: unknown): EmoteProviderSettings {
  if (typeof value !== 'object' || value === null) {
    throw new Error('emoteProviders must be an object')
  }

  const { sevenTv, bttv } = value as Record<string, unknown>

  if (typeof sevenTv !== 'boolean' || typeof bttv !== 'boolean') {
    throw new Error('emoteProviders.sevenTv and emoteProviders.bttv must be booleans')
  }

  return { sevenTv, bttv }
}

export function parseAddSource(value: unknown): AddSourceRequest {
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
