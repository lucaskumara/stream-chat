import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccountState,
  AddSourceRequest,
  ChatApi,
  ChatBatch,
  ChatMessage,
  HostPlatform,
  Platform,
  SourceState
} from '@shared/types'

const IPC = {
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

  sendMessage: (sourceId: string, text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sendMessage, sourceId, text),

  watchChannel: (platform: Platform, identifier: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.watchChannel, platform, identifier),

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

  accounts: (): Promise<AccountState[]> => ipcRenderer.invoke(IPC.accounts),

  accountSignIn: (platform: Platform): Promise<void> =>
    ipcRenderer.invoke(IPC.accountSignIn, platform),

  accountSignOut: (platform: Platform): Promise<void> =>
    ipcRenderer.invoke(IPC.accountSignOut, platform),

  onAccounts: (cb: (states: AccountState[]) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, states: AccountState[]): void => cb(states)
    ipcRenderer.on(IPC.accountState, handler)
    return () => {
      ipcRenderer.off(IPC.accountState, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
