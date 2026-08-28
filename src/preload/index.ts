import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddSourceRequest,
  ChatApi,
  ChatBatch,
  DeviceCodePrompt,
  SourceState,
  TwitchAuthState
} from '@shared/types'

const IPC = {
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

const api: ChatApi = {
  listSources: (): Promise<SourceState[]> => ipcRenderer.invoke(IPC.listSources),

  addSource: (req: AddSourceRequest): Promise<string> =>
    ipcRenderer.invoke(IPC.addSource, req),

  removeSource: (sourceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.removeSource, sourceId),

  reorderSources: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderSources, orderedIds),

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
  },

  twitchAuthState: (): Promise<TwitchAuthState> => ipcRenderer.invoke(IPC.twitchAuthState),

  twitchStartLogin: (): Promise<DeviceCodePrompt> => ipcRenderer.invoke(IPC.twitchStartLogin),

  twitchSignOut: (): Promise<void> => ipcRenderer.invoke(IPC.twitchSignOut),

  onTwitchAuth: (cb: (state: TwitchAuthState) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: TwitchAuthState): void => cb(state)
    ipcRenderer.on(IPC.twitchAuth, handler)
    return () => {
      ipcRenderer.off(IPC.twitchAuth, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
