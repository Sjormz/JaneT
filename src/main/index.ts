import * as electron from 'electron';
import * as path from 'path';
import { TerminalManager } from './terminal';
import { SSHManager } from './ssh';
import { isAllowedExternalUrl } from './externalUrls';
import { FileSystemManager } from './filesystem';
import { GitManager } from './git';
import { SettingsManager } from './settings';
import type { SSHListDirParams } from '../shared/files';
import type {
  ReadLocalTextFileRequest,
  ReadSSHTextFileRequest,
  TextFileResult,
  TextFileSnapshot,
  TextFileWriteValue,
  WriteLocalTextFileRequest,
  WriteSSHTextFileRequest,
} from '../shared/textFiles';
import {
  createRendererProtocolHandler,
  RENDERER_ORIGIN,
  RENDERER_SCHEME,
  RENDERER_SCHEME_REGISTRATION,
} from './rendererProtocol';
import {
  WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL,
  WorkspaceClosePreparationCoordinator,
  WorkspaceLifecycleController,
  type WorkspaceCloseReason,
  type WorkspacePrepareForCloseDecision,
} from './workspaceLifecycle';

let mainWindow: electron.BrowserWindow | null = null;
let initializeUpdaterForWindow: ((window: electron.BrowserWindow) => void) | null = null;
let terminalManager: TerminalManager;
let sshManager: SSHManager;
let fsManager: FileSystemManager;
let gitManager: GitManager;
let settingsManager: SettingsManager;
let workspaceLifecycle: WorkspaceLifecycleController;
let quittingAfterWorkspaceStop = false;
const closePreparation = new WorkspaceClosePreparationCoordinator();

electron.protocol.registerSchemesAsPrivileged([RENDERER_SCHEME_REGISTRATION]);

const e2eEventsPath = process.env.JANET_E2E_EVENTS_PATH;
const e2eRemoteDebuggingPort = process.env.JANET_E2E_REMOTE_DEBUGGING_PORT;

if (e2eRemoteDebuggingPort) {
  electron.app.commandLine.appendSwitch('remote-debugging-port', e2eRemoteDebuggingPort);
}

if (process.env.JANET_E2E_USER_DATA_DIR) {
  electron.app.setPath('userData', process.env.JANET_E2E_USER_DATA_DIR);
}

const hasSingleInstanceLock = electron.app.requestSingleInstanceLock();
let restoreRequestedBySecondInstance = false;
if (!hasSingleInstanceLock) {
  electron.app.quit();
} else {
  electron.app.on('second-instance', () => {
    restoreRequestedBySecondInstance = true;
    if (!electron.app.isReady() || !workspaceLifecycle) return;
    restoreRequestedBySecondInstance = false;
    showOrCreateWindow();
  });
}

function recordE2eEvent(event: Record<string, unknown>): void {
  if (!e2eEventsPath) return;
  try {
    require('fs').appendFileSync(e2eEventsPath, `${JSON.stringify({ ts: Date.now(), ...event })}\n`, 'utf-8');
  } catch {}
}

function openAllowedExternalUrl(url: string): boolean {
  if (!isAllowedExternalUrl(url)) return false;
  void electron.shell.openExternal(url).catch((error) => {
    console.error('[external-url] failed to open URL:', error);
  });
  return true;
}

// A validated 32,768-character path can expand up to 4x when POSIX single
// quotes are escaped, plus the surrounding quotes and trailing separator.
const MAX_CLIPBOARD_TEXT_LENGTH = 131_075;
const MAX_TERMINAL_CLIPBOARD_TEXT_LENGTH = 1_048_576;
const UNSAFE_CLIPBOARD_TEXT = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export function copyTextToClipboard(
  text: unknown,
  writeText: (safeText: string) => void = (safeText) => electron.clipboard.writeText(safeText),
): boolean {
  if (
    typeof text !== 'string'
    || text.length === 0
    || text.length > MAX_CLIPBOARD_TEXT_LENGTH
    || UNSAFE_CLIPBOARD_TEXT.test(text)
  ) {
    return false;
  }
  writeText(text);
  return true;
}

export function copyTerminalTextToClipboard(
  text: unknown,
  writeText: (selection: string) => void = (selection) => electron.clipboard.writeText(selection),
): boolean {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TERMINAL_CLIPBOARD_TEXT_LENGTH) {
    return false;
  }
  writeText(text);
  return true;
}

async function stopWorkspaceResources(): Promise<void> {
  await terminalManager.stopAll();
  fsManager.cleanup();
  sshManager.cleanup();
}

async function requestRendererClosePreparation(
  reason: WorkspaceCloseReason,
): Promise<WorkspacePrepareForCloseDecision> {
  try {
    const window = mainWindow;
    if (
      !window
      || window.isDestroyed()
      || window.webContents.isDestroyed()
      || window.webContents.isLoadingMainFrame()
    ) {
      return 'cancel';
    }

    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();

    const resolution = await closePreparation.request(window.webContents, reason);
    recordE2eEvent({ type: 'workspace:prepare-for-close', reason, resolution });
    return resolution;
  } catch (error) {
    console.error('[workspace] renderer close preparation unavailable:', error);
    recordE2eEvent({ type: 'workspace:prepare-for-close', reason, resolution: 'cancel' });
    return 'cancel';
  }
}

async function prepareForUpdateInstall(): Promise<boolean> {
  if (!await workspaceLifecycle.prepareForClose('update-install')) return false;
  await stopWorkspaceResources();
  return true;
}

function showOrCreateWindow(): void {
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  createWindow();
}

function createWindow() {
  // Remove the default application menu (File / Edit / View / Window).
  // JaneT uses a fully custom in-renderer titlebar.
  electron.Menu.setApplicationMenu(null);

  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'JaneT',
    backgroundColor: '#0f0f1a',
    ...(process.platform === 'darwin' ? {} : {
      icon: path.join(electron.app.getAppPath(), 'assets', 'runtime', 'app-icon-256.png'),
    }),
    autoHideMenuBar: true,
    // Remove the OS-level window chrome — the custom in-renderer titlebar
    // provides its own drag region and min/max/close controls.
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const window = mainWindow;
  initializeUpdaterForWindow?.(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    // Programmatic loadURL/loadFile calls do not emit will-navigate. Any
    // different URL here originated in page content or user navigation and
    // must not inherit JaneT's privileged preload bridge.
    if (url === window.webContents.getURL()) return;
    event.preventDefault();
    openAllowedExternalUrl(url);
  });

  // In dev, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.JANET_DEV_SERVER_URL || 'http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    // Surface renderer errors and console output to the main-process
    // stdout, so when the window is blank we can see why.
    (mainWindow.webContents as any).on('console-message', (detailsOrLevel: any, ...legacy: any[]) => {
      const details = typeof detailsOrLevel === 'object' && detailsOrLevel !== null
        ? detailsOrLevel
        : { level: detailsOrLevel, message: legacy[0] ?? '', lineNumber: legacy[1] ?? 0, sourceId: legacy[2] ?? '' };
      const tagByLevel: Record<string, string> = {
        log: 'LOG',
        warning: 'WARN',
        error: 'ERROR',
        info: 'INFO',
        debug: 'DEBUG',
      };
      const numericTags = ['LOG', 'WARN', 'ERROR', 'INFO'];
      const tag = typeof details.level === 'number'
        ? numericTags[details.level] || `L${details.level}`
        : tagByLevel[details.level] || String(details.level).toUpperCase();
      console.log(`[renderer ${tag}] ${details.sourceId}:${details.lineNumber}  ${details.message}`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[renderer] CRASH:', details);
    });
    mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`);
    });
  } else {
    mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html`);
  }

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.on('close', (event) => {
    if (quittingAfterWorkspaceStop) return;
    event.preventDefault();
    void workspaceLifecycle.handleClose().catch((error) => {
      console.error('[workspace] close failed:', error);
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
      electron.dialog.showErrorBox('Could not close JaneT safely', error instanceof Error ? error.message : String(error));
    });
  });
}

electron.app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  if (process.env.NODE_ENV !== 'development') {
    const rendererRoot = path.join(__dirname, '../renderer');
    electron.protocol.handle(
      RENDERER_SCHEME,
      createRendererProtocolHandler(rendererRoot, (fileUrl) => electron.net.fetch(fileUrl)),
    );
  }
  terminalManager = new TerminalManager();
  fsManager = new FileSystemManager();
  gitManager = new GitManager();
  settingsManager = new SettingsManager();
  sshManager = new SSHManager({
    lookup: (host, port) => settingsManager.getSshHostKey(host, port),
    remember: (host, port, fingerprint) => settingsManager.rememberSshHostKey(host, port, fingerprint),
    migrate: (host, port, expectedFingerprint, fingerprint) => (
      settingsManager.migrateSshHostKey(host, port, expectedFingerprint, fingerprint)
    ),
  }, async (host, port, fingerprint) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return false;

    const { response } = await electron.dialog.showMessageBox(window, {
      type: 'warning',
      title: 'New SSH host',
      message: `Trust and connect to ${host}:${port}?`,
      detail: `Verify this SHA-256 fingerprint before continuing:\n\n${fingerprint}`,
      buttons: ['Trust and connect', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return response === 0;
  }, (event) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    window.webContents.send('ssh:onConnectionClosed', event);
  });

  workspaceLifecycle = new WorkspaceLifecycleController({
    requestClosePreparation: requestRendererClosePreparation,
    stopAll: stopWorkspaceResources,
    quit: () => {
      quittingAfterWorkspaceStop = true;
      electron.app.quit();
    },
  });

  // Update-driven window closes happen before the normal app `before-quit`
  // event. Only bypass the workspace close guard once Electron confirms the
  // installer has committed to quitting; preparation alone can still fail.
  electron.autoUpdater.on('before-quit-for-update', () => {
    quittingAfterWorkspaceStop = true;
  });

  electron.app.on('before-quit', (event) => {
    if (quittingAfterWorkspaceStop) return;
    const window = mainWindow;
    if (!window || window.isDestroyed()) return;
    event.preventDefault();
    void workspaceLifecycle.handleQuit().catch((error) => {
      console.error('[workspace] quit failed:', error);
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
      electron.dialog.showErrorBox('Could not quit JaneT safely', error instanceof Error ? error.message : String(error));
    });
  });

  registerIpcHandlers();
  createWindow();
  if (restoreRequestedBySecondInstance) {
    restoreRequestedBySecondInstance = false;
    showOrCreateWindow();
  }

  // Initialize auto-updater. Keep this lazy so physical e2e launches can run
  // the built Electron app without electron-updater touching app internals at
  // module import time.
  if (mainWindow && process.env.NODE_ENV !== 'test') {
    import('./updater').then(({ initUpdater, checkForUpdates }) => {
      initializeUpdaterForWindow = (nextWindow) => initUpdater(nextWindow, prepareForUpdateInstall);
      const window = mainWindow;
      if (!window || window.isDestroyed()) return;
      initUpdater(window, prepareForUpdateInstall);
      // Check for updates after a short delay so the app is fully settled
      setTimeout(() => checkForUpdates(true), 5000);
    }).catch((err) => console.error('[updater] failed to initialize:', err));
  }

  electron.app.on('activate', () => {
    showOrCreateWindow();
  });
});

electron.app.on('window-all-closed', () => {
  if (!hasSingleInstanceLock) return;
  terminalManager.cleanup();
  fsManager.cleanup();
  sshManager.cleanup();
  if (process.platform !== 'darwin') {
    electron.app.quit();
  }
});

function registerIpcHandlers() {
  const handle = (
    channel: string,
    listener: (event: electron.IpcMainInvokeEvent, ...args: any[]) => any,
  ): void => {
    electron.ipcMain.handle(channel, (event, ...args) => {
      const window = mainWindow;
      if (
        !window || window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      ) {
        throw new Error(`Rejected untrusted IPC sender for ${channel}`);
      }
      return listener(event, ...args);
    });
  };

  // === Terminal IPC ===
  handle('terminal:create', (event, { id, cwd, shell, startupCommands }) => {
    const pty = terminalManager.create(id, cwd, shell, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:onData', { id, data });
      }
    }, startupCommands);
    return { pid: pty.pid };
  });

  handle('terminal:resize', (event, { id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
  });

  handle('terminal:write', (event, { id, data, userInput }) => {
    terminalManager.write(id, data, userInput !== false);
  });
  handle('terminal:writeBinary', (event, { id, data, userInput }) => {
    terminalManager.writeBinary(id, data, userInput !== false);
  });

  handle('terminal:destroy', (event, { id }) => {
    terminalManager.destroy(id);
  });

  // === SSH IPC ===
  handle('ssh:connect', async (event, { id, host, port, username, auth, password, privateKey }) => {
    recordE2eEvent({ type: 'ssh:connect:start', id, host, port, username });
    await sshManager.connect(id, { host, port, username, auth, password, privateKey });
    recordE2eEvent({ type: 'ssh:connect:done', id });
    return { connected: true };
  });

  handle('ssh:createShell', (event, {
    id, termId, cols, rows, startupCommands, startupShellDialect,
  }) => {
    recordE2eEvent({ type: 'ssh:createShell:start', id, termId, cols, rows });
    const shell = sshManager.createShell(
      id,
      termId,
      { cols, rows },
      startupCommands,
      startupShellDialect,
    );
    shell.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:onData', { id: termId, data });
      }
    });
    return shell.ready.then(() => ({ connected: true }));
  });

  handle('ssh:writeShell', (event, { sessionId, termId, data, userInput }) => {
    sshManager.writeShell(termId, data, sessionId, userInput !== false);
  });
  handle('ssh:writeShellBinary', (event, { sessionId, termId, data, userInput }) => {
    sshManager.writeShellBinary(termId, data, sessionId, userInput !== false);
  });

  handle('ssh:destroyShell', (event, { sessionId, termId }) => {
    return sshManager.destroyShell(termId, sessionId);
  });

  handle('ssh:resizeShell', (event, { termId, cols, rows }) => {
    sshManager.resizeShell(termId, cols, rows);
  });

  handle('ssh:listDir', async (event, params: SSHListDirParams) => {
    return await sshManager.listDir(params?.sessionId, params?.remotePath, params?.showHidden);
  });

  handle('ssh:readTextFile', async (
    event,
    request: ReadSSHTextFileRequest,
  ): Promise<TextFileResult<TextFileSnapshot>> => {
    return await sshManager.readTextFile(request);
  });

  handle('ssh:writeTextFile', async (
    event,
    request: WriteSSHTextFileRequest,
  ): Promise<TextFileResult<TextFileWriteValue>> => {
    return await sshManager.writeTextFile(request);
  });

  handle('ssh:disconnect', async (event, { id }) => {
    await sshManager.disconnect(id);
  });

  handle('ssh:listConnections', () => {
    return sshManager.listConnections();
  });

  // === File System IPC ===
  handle('fs:listDir', async (event, { dirPath, showHidden }) => {
    return await fsManager.listDir(dirPath, showHidden);
  });

  handle('fs:getHome', () => {
    return fsManager.getHome();
  });

  handle('fs:getDrives', () => {
    return fsManager.getDrives();
  });

  handle('fs:stat', async (event, { filePath }) => {
    return await fsManager.stat(filePath);
  });

  handle('fs:readTextFile', async (
    event,
    request: ReadLocalTextFileRequest,
  ): Promise<TextFileResult<TextFileSnapshot>> => {
    return await fsManager.readTextFile(request);
  });

  handle('fs:writeTextFile', async (
    event,
    request: WriteLocalTextFileRequest,
  ): Promise<TextFileResult<TextFileWriteValue>> => {
    return await fsManager.writeTextFile(request);
  });

  // === Git IPC ===
  handle('git:status', async (event, { repoPath }) => {
    return await gitManager.status(repoPath);
  });

  handle('git:branches', async (event, { repoPath }) => {
    return await gitManager.branches(repoPath);
  });

  handle('git:details', async (event, { repoPath }) => {
    return await gitManager.details(repoPath);
  });

  handle('git:log', async (event, { repoPath, maxCount }) => {
    return await gitManager.log(repoPath, maxCount);
  });

  handle('git:findRepo', async (event, { startPath }) => {
    return await gitManager.findRepo(startPath);
  });

  handle('git:checkout', async (event, { repoPath, branch }) => {
    return await gitManager.checkout(repoPath, branch);
  });

  handle('git:createBranch', async (event, { repoPath, branch, startPoint, checkout }) => {
    return await gitManager.createBranch(repoPath, branch, startPoint, checkout);
  });

  handle('git:deleteBranch', async (event, { repoPath, branch, force }) => {
    return await gitManager.deleteBranch(repoPath, branch, force);
  });

  handle('git:stage', async (event, { repoPath, paths }) => {
    return await gitManager.stage(repoPath, paths);
  });

  handle('git:unstage', async (event, { repoPath, paths }) => {
    return await gitManager.unstage(repoPath, paths);
  });

  handle('git:commit', async (event, { repoPath, message }) => {
    return await gitManager.commit(repoPath, message);
  });

  handle('git:fetch', async (event, { repoPath }) => {
    return await gitManager.fetch(repoPath);
  });

  handle('git:pull', async (event, { repoPath }) => {
    return await gitManager.pull(repoPath);
  });

  handle('git:push', async (event, { repoPath }) => {
    return await gitManager.push(repoPath);
  });

  handle('git:worktrees', async (event, { repoPath }) => {
    return await gitManager.worktrees(repoPath);
  });

  handle('git:addWorktree', async (event, { repoPath, worktreePath, branch, createBranch, startPoint }) => {
    return await gitManager.addWorktree(repoPath, worktreePath, branch, createBranch, startPoint);
  });

  handle('git:removeWorktree', async (event, { repoPath, worktreePath, force }) => {
    return await gitManager.removeWorktree(repoPath, worktreePath, force);
  });

  handle('git:pruneWorktrees', async (event, { repoPath }) => {
    return await gitManager.pruneWorktrees(repoPath);
  });

  // === Settings IPC ===
  handle('settings:get', () => {
    return settingsManager.get();
  });

  handle('settings:set', (event, updates) => {
    return settingsManager.set(updates);
  });

  handle('app:getPlatform', () => {
    return process.platform;
  });

  handle('app:openExternal', async (event, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) return false;
    await electron.shell.openExternal(url);
    return true;
  });

  handle('app:copyText', (event, text: unknown) => {
    return copyTextToClipboard(text);
  });

  handle('app:copyTerminalText', (event, text: unknown) => {
    return copyTerminalTextToClipboard(text);
  });

  handle(WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL, (event, resolution: unknown) => {
    return closePreparation.resolve(event.sender, resolution);
  });

  // === Window controls (for custom titlebar) ===
  handle('window:minimize', () => mainWindow?.minimize());
  handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  handle('window:close', () => mainWindow?.close());
  handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
}
