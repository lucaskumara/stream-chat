import { contextBridge, ipcRenderer } from 'electron'
import type {
  AddSourceRequest,
  ChatApi,
  ChatBatch,
  ChatMessage,
  DeviceCodePrompt,
  HostPlatform,
  SourceState,
  TwitchAuthState
} from '@shared/types'

const IPC = {
  listSources: 'sources:list',
  addSource: 'sources:add',
  removeSource: 'sources:remove',
  reorderSources: 'sources:reorder',
  sourceBacklog: 'sources:backlog',
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

const HOSTS: HostPlatform[] = ['darwin', 'win32', 'linux']

const host = HOSTS.find((candidate) => candidate === process.platform) ?? 'other'

const api: ChatApi = {
  platform: host,

  listSources: (): Promise<SourceState[]> => ipcRenderer.invoke(IPC.listSources),

  addSource: (req: AddSourceRequest): Promise<string> =>
    ipcRenderer.invoke(IPC.addSource, req),

  removeSource: (sourceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.removeSource, sourceId),

  reorderSources: (orderedIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.reorderSources, orderedIds),

  sourceBacklog: (sourceId: string): Promise<ChatMessage[]> =>
    ipcRenderer.invoke(IPC.sourceBacklog, sourceId),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.openExternal, url),

  copyText: (text: string): Promise<void> => ipcRenderer.invoke(IPC.copyText, text),

  obsLink: (sourceId: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.obsLink, sourceId),

  windowMinimize: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),

  windowToggleMaximize: (): Promise<void> => ipcRenderer.invoke(IPC.windowToggleMaximize),

  windowClose: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),

  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),

  onWindowMaximized: (cb: (maximized: boolean) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, maximized: boolean): void => cb(maximized)
    ipcRenderer.on(IPC.windowMaximized, handler)
    return () => {
      ipcRenderer.off(IPC.windowMaximized, handler)
    }
  },

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
