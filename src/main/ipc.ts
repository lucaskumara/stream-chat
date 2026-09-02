import { BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import type { AddSourceRequest, Platform } from '@shared/types'
import { PLATFORMS } from '@shared/types'
import { obsChatPath } from '@shared/obs'
import type { MessageBus } from './bus'
import type { ObsServer } from './obs/server'
import type { SourceManager } from './sources'
import type { AccountManager } from './accounts'

const MAX_LABEL_LENGTH = 80
const MAX_IDENTIFIER_LENGTH = 100
const MAX_COPY_LENGTH = 2000

export const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  reorderSources: 'sources:reorder',
  sourceBacklog: 'sources:backlog',
  sendMessage: 'chat:send',
  watchChannel: 'sources:watch',
  openExternal: 'shell:open-external',
  copyText: 'clipboard:write',
  obsLink: 'obs:link',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximized: 'window:maximized',

  accounts: 'accounts:list',
  accountSignIn: 'accounts:sign-in',
  accountSignOut: 'accounts:sign-out',

  batch: 'chat:batch',
  sourceState: 'sources:state',
  accountState: 'accounts:state'
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
  accounts: AccountManager,
  obs: ObsServer,
  bus: MessageBus,
  watch: (platform: Platform, identifier: string | null) => Promise<void>
): void {
  registerSourceHandlers(sources, bus)

  handle(IPC.watchChannel, async (_e, platform: unknown, identifier: unknown) => {
    await watch(parsePlatform(platform), parseWatchTarget(identifier))
  })

  registerShellHandlers()
  registerWindowHandlers()
  registerAccountHandlers(sources, accounts)
  registerObsHandlers(sources, obs)
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

  handle(IPC.sendMessage, async (_e, sourceId: unknown, text: unknown) => {
    await sources.send(requireString(sourceId, 'sourceId'), parseMessageText(text))
  })
}

/** Null means "go back to the account's own channel", which is the normal state — the
    override exists so another channel's chat can be read and typed into while testing. */
export function parseWatchTarget(value: unknown): string | null {
  if (value === null || value === undefined) return null

  const identifier = requireString(value, 'identifier').trim()

  return identifier ? identifier.slice(0, MAX_IDENTIFIER_LENGTH) : null
}

const MAX_MESSAGE_LENGTH = 500

/** Twitch caps a message at 500 characters and Kick at 500 grapheme clusters, so the
    renderer is not trusted to have enforced either. An empty message is refused here
    rather than spending a request to be told so. */
export function parseMessageText(value: unknown): string {
  const text = requireString(value, 'text').trim()

  if (!text) throw new Error('message is empty')

  return text.slice(0, MAX_MESSAGE_LENGTH)
}

function registerShellHandlers(): void {
  handle(IPC.openExternal, async (_e, url: unknown) => {
    await shell.openExternal(parseWebUrl(url))
  })

  handle(IPC.copyText, (_e, text: unknown) => {
    clipboard.writeText(requireString(text, 'text').slice(0, MAX_COPY_LENGTH))
  })
}

/** Main owns the port and the key spelling, so the renderer asks for a finished
    link rather than assembling one. Null means the link server never bound. */
function registerObsHandlers(sources: SourceManager, obs: ObsServer): void {
  handle(IPC.obsLink, (_e, sourceId: unknown) => {
    const base = obs.baseUrl()
    if (!base) return null

    const target = sources.targetOf(requireString(sourceId, 'sourceId'))
    if (!target) return null

    return `${base}${obsChatPath(target.platform, target.identifier)}`
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

/** Signing out of Twitch drops its chats, because the transport is chosen by whether a
    token exists — the other two do not touch chat at all, so their sessions come and go
    without disturbing anything on screen. */
function registerAccountHandlers(sources: SourceManager, accounts: AccountManager): void {
  handle(IPC.accounts, () => accounts.list())

  handle(IPC.accountSignIn, async (_e, platform: unknown) => {
    await accounts.signIn(parsePlatform(platform))
  })

  handle(IPC.accountSignOut, async (_e, platform: unknown) => {
    const target = parsePlatform(platform)

    if (target === 'twitch') await sources.removeByPlatform('twitch')

    await accounts.signOut(target)
  })
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
