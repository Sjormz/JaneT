import { contextBridge, ipcRenderer } from 'electron';
import type {
  FileEntry,
  SSHConnectionClosedEvent,
  SSHDirectoryListing,
  SSHListDirParams,
} from '../shared/files';
import type { StartupShellDialect } from '../shared/startupCommands';
import {
  WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL,
  WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL,
  type WorkspacePrepareForCloseRequest,
  type WorkspacePrepareForCloseResolution,
} from './workspaceLifecycle';
import type {
  ReadLocalTextFileRequest,
  ReadSSHTextFileRequest,
  TextFileResult,
  TextFileSnapshot,
  TextFileWriteValue,
  WriteLocalTextFileRequest,
  WriteSSHTextFileRequest,
} from '../shared/textFiles';

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

type PrepareForCloseCallback = (
  request: WorkspacePrepareForCloseRequest,
) => void | Promise<void>;

let prepareForCloseCallback: PrepareForCloseCallback | null = null;

function safelyCancelClosePreparation(request: WorkspacePrepareForCloseRequest): void {
  void ipcRenderer.invoke(WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL, {
    requestId: request.requestId,
    resolution: 'cancel',
  } satisfies WorkspacePrepareForCloseResolution).catch(() => {});
}

// Register this listener during preload evaluation, before renderer scripts
// run. If the application never subscribes (or its callback fails), reply with
// the safe outcome instead of leaving the main process waiting indefinitely.
ipcRenderer.on(WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL, (
  _event: Electron.IpcRendererEvent,
  request: WorkspacePrepareForCloseRequest,
) => {
  if (!request || typeof request.requestId !== 'string') return;
  const callback = prepareForCloseCallback;
  if (!callback) {
    safelyCancelClosePreparation(request);
    return;
  }
  try {
    void Promise.resolve(callback(request)).catch(() => {
      safelyCancelClosePreparation(request);
    });
  } catch {
    safelyCancelClosePreparation(request);
  }
});

const api = {
  // Terminal
  terminalCreate: (params: {
    id: string;
    cwd?: string;
    shell?: string;
    startupCommands?: string[];
    startupShellDialect?: StartupShellDialect;
  }) =>
    ipcRenderer.invoke('terminal:create', params),
  terminalResize: (params: { id: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:resize', params),
  terminalWrite: (params: { id: string; data: string; userInput?: boolean }) =>
    ipcRenderer.invoke('terminal:write', params),
  terminalWriteBinary: (params: { id: string; data: string; userInput?: boolean }) =>
    ipcRenderer.invoke('terminal:writeBinary', params),
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
  sshCreateShell: (params: {
    id: string;
    termId: string;
    cols: number;
    rows: number;
    startupCommands?: string[];
    startupShellDialect?: StartupShellDialect;
  }) =>
    ipcRenderer.invoke('ssh:createShell', params),
  sshWriteShell: (params: { sessionId?: string; termId: string; data: string; userInput?: boolean }) =>
    ipcRenderer.invoke('ssh:writeShell', params),
  sshWriteShellBinary: (params: { sessionId?: string; termId: string; data: string; userInput?: boolean }) =>
    ipcRenderer.invoke('ssh:writeShellBinary', params),
  sshDestroyShell: (params: { sessionId?: string; termId: string }) =>
    ipcRenderer.invoke('ssh:destroyShell', params),
  sshResizeShell: (params: { termId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('ssh:resizeShell', params),
  sshListDir: (params: SSHListDirParams): Promise<SSHDirectoryListing> =>
    ipcRenderer.invoke('ssh:listDir', params),
  sshReadTextFile: (params: ReadSSHTextFileRequest): Promise<TextFileResult<TextFileSnapshot>> =>
    ipcRenderer.invoke('ssh:readTextFile', params),
  sshWriteTextFile: (params: WriteSSHTextFileRequest): Promise<TextFileResult<TextFileWriteValue>> =>
    ipcRenderer.invoke('ssh:writeTextFile', params),
  sshDisconnect: (params: { id: string }) =>
    ipcRenderer.invoke('ssh:disconnect', params),
  sshListConnections: () =>
    ipcRenderer.invoke('ssh:listConnections'),
  onSSHConnectionClosed: (callback: (event: SSHConnectionClosedEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: SSHConnectionClosedEvent) => callback(data);
    ipcRenderer.on('ssh:onConnectionClosed', handler);
    return () => {
      ipcRenderer.removeListener('ssh:onConnectionClosed', handler);
    };
  },

  // File System
  fsListDir: (params: { dirPath: string; showHidden?: boolean }): Promise<FileEntry[]> =>
    ipcRenderer.invoke('fs:listDir', params),
  fsGetHome: () => ipcRenderer.invoke('fs:getHome'),
  fsGetDrives: () => ipcRenderer.invoke('fs:getDrives'),
  fsStat: (params: { filePath: string }) =>
    ipcRenderer.invoke('fs:stat', params),
  fsReadTextFile: (params: ReadLocalTextFileRequest): Promise<TextFileResult<TextFileSnapshot>> =>
    ipcRenderer.invoke('fs:readTextFile', params),
  fsWriteTextFile: (params: WriteLocalTextFileRequest): Promise<TextFileResult<TextFileWriteValue>> =>
    ipcRenderer.invoke('fs:writeTextFile', params),

  // Git
  gitStatus: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:status', params),
  gitBranches: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:branches', params),
  gitDetails: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:details', params),
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
  gitStage: (params: { repoPath: string; paths: string[] }) =>
    ipcRenderer.invoke('git:stage', params),
  gitUnstage: (params: { repoPath: string; paths: string[] }) =>
    ipcRenderer.invoke('git:unstage', params),
  gitCommit: (params: { repoPath: string; message: string }) =>
    ipcRenderer.invoke('git:commit', params),
  gitFetch: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:fetch', params),
  gitPull: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:pull', params),
  gitPush: (params: { repoPath: string }) =>
    ipcRenderer.invoke('git:push', params),
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
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('app:copyText', text),
  copyTerminalText: (text: string): Promise<boolean> => ipcRenderer.invoke('app:copyTerminalText', text),
  onPrepareForClose: (callback: PrepareForCloseCallback) => {
    prepareForCloseCallback = callback;
    return () => {
      if (prepareForCloseCallback === callback) prepareForCloseCallback = null;
    };
  },
  resolvePrepareForClose: (resolution: WorkspacePrepareForCloseResolution): Promise<boolean> =>
    ipcRenderer.invoke(WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL, resolution),

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
