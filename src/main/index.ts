import * as electron from 'electron';
import * as path from 'path';
import { TerminalManager } from './terminal';
import { SSHManager } from './ssh';
import { FileSystemManager } from './filesystem';
import { GitManager } from './git';
import { SettingsManager } from './settings';

let mainWindow: electron.BrowserWindow | null = null;
let terminalManager: TerminalManager;
let sshManager: SSHManager;
let fsManager: FileSystemManager;
let gitManager: GitManager;
let settingsManager: SettingsManager;

const e2eEventsPath = process.env.JANET_E2E_EVENTS_PATH;
const e2eRemoteDebuggingPort = process.env.JANET_E2E_REMOTE_DEBUGGING_PORT;

if (e2eRemoteDebuggingPort) {
  electron.app.commandLine.appendSwitch('remote-debugging-port', e2eRemoteDebuggingPort);
}

if (process.env.JANET_E2E_USER_DATA_DIR) {
  electron.app.setPath('userData', process.env.JANET_E2E_USER_DATA_DIR);
}

function recordE2eEvent(event: Record<string, unknown>): void {
  if (!e2eEventsPath) return;
  try {
    require('fs').appendFileSync(e2eEventsPath, `${JSON.stringify({ ts: Date.now(), ...event })}\n`, 'utf-8');
  } catch {}
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
    autoHideMenuBar: true,
    // Remove the OS-level window chrome — the custom in-renderer titlebar
    // provides its own drag region and min/max/close controls.
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

electron.app.whenReady().then(() => {
  terminalManager = new TerminalManager();
  sshManager = new SSHManager();
  fsManager = new FileSystemManager();
  gitManager = new GitManager();
  settingsManager = new SettingsManager();

  registerIpcHandlers();
  createWindow();

  // Initialize auto-updater. Keep this lazy so physical e2e launches can run
  // the built Electron app without electron-updater touching app internals at
  // module import time.
  if (mainWindow && process.env.NODE_ENV !== 'test') {
    import('./updater').then(({ initUpdater, checkForUpdates }) => {
      if (!mainWindow) return;
      initUpdater(mainWindow);
      // Check for updates after a short delay so the app is fully settled
      setTimeout(() => checkForUpdates(true), 5000);
    }).catch((err) => console.error('[updater] failed to initialize:', err));
  }

  electron.app.on('activate', () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

electron.app.on('window-all-closed', () => {
  terminalManager.cleanup();
  sshManager.cleanup();
  if (process.platform !== 'darwin') {
    electron.app.quit();
  }
});

function registerIpcHandlers() {
  // === Terminal IPC ===
  electron.ipcMain.handle('terminal:create', (event, { id, cwd, shell }) => {
    const pty = terminalManager.create(id, cwd, shell, (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:onData', { id, data });
      }
    });
    return { pid: pty.pid };
  });

  electron.ipcMain.handle('terminal:resize', (event, { id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
  });

  electron.ipcMain.handle('terminal:write', (event, { id, data }) => {
    terminalManager.write(id, data);
  });

  electron.ipcMain.handle('terminal:destroy', (event, { id }) => {
    terminalManager.destroy(id);
  });

  // === SSH IPC ===
  electron.ipcMain.handle('ssh:connect', async (event, { id, host, port, username, auth, password, privateKey }) => {
    recordE2eEvent({ type: 'ssh:connect:start', id, host, port, username });
    await sshManager.connect(id, { host, port, username, auth, password, privateKey });
    recordE2eEvent({ type: 'ssh:connect:done', id });
    return { connected: true };
  });

  electron.ipcMain.handle('ssh:createShell', (event, { id, termId, cols, rows }) => {
    recordE2eEvent({ type: 'ssh:createShell:start', id, termId, cols, rows });
    const shell = sshManager.createShell(id, termId, { cols, rows });
    shell.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:onData', { id: termId, data });
      }
    });
    return shell.ready.then(() => ({ connected: true }));
  });

  electron.ipcMain.handle('ssh:writeShell', (event, { termId, data }) => {
    sshManager.writeShell(termId, data);
  });

  electron.ipcMain.handle('ssh:resizeShell', (event, { termId, cols, rows }) => {
    sshManager.resizeShell(termId, cols, rows);
  });

  electron.ipcMain.handle('ssh:listDir', async (event, { sessionId, remotePath }) => {
    return await sshManager.listDir(sessionId, remotePath);
  });

  electron.ipcMain.handle('ssh:disconnect', async (event, { id }) => {
    await sshManager.disconnect(id);
  });

  electron.ipcMain.handle('ssh:listConnections', () => {
    return sshManager.listConnections();
  });

  // === File System IPC ===
  electron.ipcMain.handle('fs:listDir', async (event, { dirPath, showHidden }) => {
    return await fsManager.listDir(dirPath, showHidden);
  });

  electron.ipcMain.handle('fs:getHome', () => {
    return fsManager.getHome();
  });

  electron.ipcMain.handle('fs:getDrives', () => {
    return fsManager.getDrives();
  });

  electron.ipcMain.handle('fs:stat', async (event, { filePath }) => {
    return await fsManager.stat(filePath);
  });

  // === Git IPC ===
  electron.ipcMain.handle('git:status', async (event, { repoPath }) => {
    return await gitManager.status(repoPath);
  });

  electron.ipcMain.handle('git:branches', async (event, { repoPath }) => {
    return await gitManager.branches(repoPath);
  });

  electron.ipcMain.handle('git:log', async (event, { repoPath, maxCount }) => {
    return await gitManager.log(repoPath, maxCount);
  });

  electron.ipcMain.handle('git:findRepo', async (event, { startPath }) => {
    return await gitManager.findRepo(startPath);
  });

  electron.ipcMain.handle('git:checkout', async (event, { repoPath, branch }) => {
    return await gitManager.checkout(repoPath, branch);
  });

  electron.ipcMain.handle('git:createBranch', async (event, { repoPath, branch, startPoint, checkout }) => {
    return await gitManager.createBranch(repoPath, branch, startPoint, checkout);
  });

  electron.ipcMain.handle('git:deleteBranch', async (event, { repoPath, branch, force }) => {
    return await gitManager.deleteBranch(repoPath, branch, force);
  });

  electron.ipcMain.handle('git:worktrees', async (event, { repoPath }) => {
    return await gitManager.worktrees(repoPath);
  });

  electron.ipcMain.handle('git:addWorktree', async (event, { repoPath, worktreePath, branch, createBranch, startPoint }) => {
    return await gitManager.addWorktree(repoPath, worktreePath, branch, createBranch, startPoint);
  });

  electron.ipcMain.handle('git:removeWorktree', async (event, { repoPath, worktreePath, force }) => {
    return await gitManager.removeWorktree(repoPath, worktreePath, force);
  });

  electron.ipcMain.handle('git:pruneWorktrees', async (event, { repoPath }) => {
    return await gitManager.pruneWorktrees(repoPath);
  });

  // === Settings IPC ===
  electron.ipcMain.handle('settings:get', () => {
    return settingsManager.get();
  });

  electron.ipcMain.handle('settings:set', (event, updates) => {
    return settingsManager.set(updates);
  });

  electron.ipcMain.handle('app:getPlatform', () => {
    return process.platform;
  });

  // === Window controls (for custom titlebar) ===
  electron.ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  electron.ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  electron.ipcMain.handle('window:close', () => mainWindow?.close());
  electron.ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);
}
