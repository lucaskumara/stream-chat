import { contextBridge, ipcRenderer } from 'electron'
import type { AddSourceRequest, ChatApi, ChatBatch, SourceState } from '@shared/types'

const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  setRate: 'sources:set-rate',
  openExternal: 'shell:open-external',
  batch: 'chat:batch',
  sourceState: 'sources:state'
} as const

/**
 * The only surface the renderer gets. No ipcRenderer passthrough: every call is
 * a named method so the renderer can never reach a channel this file doesn't
 * list. Subscriptions return an unsubscribe function so React effects can clean
 * up without leaking listeners across hot reloads.
 */
const api: ChatApi = {
  listSources: (): Promise<SourceState[]> => ipcRenderer.invoke(IPC.listSources),

  addSource: (req: AddSourceRequest): Promise<string> =>
    ipcRenderer.invoke(IPC.addSource, req),

  removeSource: (sourceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.removeSource, sourceId),

  setRate: (sourceId: string, rate: number): Promise<void> =>
    ipcRenderer.invoke(IPC.setRate, sourceId, rate),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.openExternal, url),

  onBatch: (cb: (batch: ChatBatch) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, batch: ChatBatch): void => cb(batch)
    ipcRenderer.on(IPC.batch, handler)
    return () => {
      ipcRenderer.off(IPC.batch, handler)
    }
  },

  onSources: (cb: (states: SourceState[]) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, states: SourceState[]): void => cb(states)
    ipcRenderer.on(IPC.sourceState, handler)
    return () => {
      ipcRenderer.off(IPC.sourceState, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
