import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Terminal
  terminalCreate: (params: { id: string; cwd?: string; shell?: string }) =>
    ipcRenderer.invoke('terminal:create', params),
  terminalResize: (params: { id: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:resize', params),
  terminalWrite: (params: { id: string; data: string }) =>
    ipcRenderer.invoke('terminal:write', params),
  terminalDestroy: (params: { id: string }) =>
    ipcRenderer.invoke('terminal:destroy', params),
  onTerminalData: (callback: (params: { id: string; data: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('terminal:onData', handler);
    return () => ipcRenderer.removeListener('terminal:onData', handler);
  },

  // SSH
  sshConnect: (params: { id: string; host: string; port: number; username: string; auth: string; password?: string; privateKey?: string }) =>
    ipcRenderer.invoke('ssh:connect', params),
  sshCreateShell: (params: { id: string; termId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('ssh:createShell', params),
  sshWriteShell: (params: { termId: string; data: string }) =>
    ipcRenderer.invoke('ssh:writeShell', params),
  sshResizeShell: (params: { termId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('ssh:resizeShell', params),
  sshListDir: (params: { sessionId: string; remotePath: string }) =>
    ipcRenderer.invoke('ssh:listDir', params),
  sshDisconnect: (params: { id: string }) =>
    ipcRenderer.invoke('ssh:disconnect', params),
  sshListConnections: () =>
    ipcRenderer.invoke('ssh:listConnections'),

  // File System
  fsListDir: (params: { dirPath: string; showHidden?: boolean }) =>
    ipcRenderer.invoke('fs:listDir', params),
  fsGetHome: () => ipcRenderer.invoke('fs:getHome'),
  fsGetDrives: () => ipcRenderer.invoke('fs:getDrives'),
  fsStat: (params: { filePath: string }) =>
    ipcRenderer.invoke('fs:stat', params),

  // Git
  gitStatus: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:status', params),
  gitBranches: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:branches', params),
  gitLog: (params: { repoPath: string; maxCount?: number }) =>
    ipcRenderer.invoke('git:log', params),
  gitFindRepo: (params: { startPath: string }) =>
    ipcRenderer.invoke('git:findRepo', params),
  gitCheckout: (params: { repoPath: string; branch: string }) =>
    ipcRenderer.invoke('git:checkout', params),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates: Record<string, unknown>) => ipcRenderer.invoke('settings:set', updates),

  // App
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
};

contextBridge.exposeInMainWorld('jterm', api);

export type JTermAPI = typeof api;
