import { ipcMain, shell } from 'electron'
import type { AddSourceRequest } from '@shared/types'
import type { SourceManager } from './sources'

export const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  setRate: 'sources:set-rate',
  openExternal: 'shell:open-external',
  // main -> renderer
  batch: 'chat:batch',
  sourceState: 'sources:state'
} as const

/**
 * The renderer is untrusted by construction (it renders remote chat content),
 * so every handler validates its arguments rather than trusting the preload.
 */
export function registerIpc(sources: SourceManager): void {
  ipcMain.handle(IPC.listSources, () => sources.list())

  ipcMain.handle(IPC.addSource, async (_e, req: unknown) => {
    const parsed = parseAddSource(req)
    return sources.add(parsed)
  })

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
}

export function unregisterIpc(): void {
  for (const channel of [
    IPC.listSources,
    IPC.addSource,
    IPC.removeSource,
    IPC.setRate,
    IPC.openExternal
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

  return { platform, label, rate }
}
