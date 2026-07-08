import { contextBridge, ipcRenderer } from 'electron';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdateAvailableInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

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
  sshConnect: (params: { id: string; host: string; port: number; username?: string; auth: string; password?: string; privateKey?: string }) =>
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
  gitCreateBranch: (params: { repoPath: string; branch: string; startPoint?: string; checkout?: boolean }) =>
    ipcRenderer.invoke('git:createBranch', params),
  gitDeleteBranch: (params: { repoPath: string; branch: string; force?: boolean }) =>
    ipcRenderer.invoke('git:deleteBranch', params),
  gitWorktrees: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:worktrees', params),
  gitAddWorktree: (params: { repoPath: string; worktreePath: string; branch: string; createBranch?: boolean; startPoint?: string }) =>
    ipcRenderer.invoke('git:addWorktree', params),
  gitRemoveWorktree: (params: { repoPath: string; worktreePath: string; force?: boolean }) =>
    ipcRenderer.invoke('git:removeWorktree', params),
  gitPruneWorktrees: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:pruneWorktrees', params),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (updates: Record<string, unknown>) => ipcRenderer.invoke('settings:set', updates),

  // App
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Window controls (custom titlebar)
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // === Auto-update ===
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  onUpdateChecking: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update:checking', handler);
    return () => ipcRenderer.removeListener('update:checking', handler);
  },
  onUpdateAvailable: (callback: (info: UpdateAvailableInfo) => void) => {
    const handler = (_event: any, info: UpdateAvailableInfo) => callback(info);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('update:not-available', handler);
    return () => ipcRenderer.removeListener('update:not-available', handler);
  },
  onUpdateDownloadProgress: (callback: (progress: UpdateProgress) => void) => {
    const handler = (_event: any, progress: UpdateProgress) => callback(progress);
    ipcRenderer.on('update:download-progress', handler);
    return () => ipcRenderer.removeListener('update:download-progress', handler);
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const handler = (_event: any, info: { version: string }) => callback(info);
    ipcRenderer.on('update:downloaded', handler);
    return () => ipcRenderer.removeListener('update:downloaded', handler);
  },
  onUpdateError: (callback: (error: { message: string }) => void) => {
    const handler = (_event: any, error: { message: string }) => callback(error);
    ipcRenderer.on('update:error', handler);
    return () => ipcRenderer.removeListener('update:error', handler);
  },
};

contextBridge.exposeInMainWorld('janet', api);

export type JanetAPI = typeof api;
