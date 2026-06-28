import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { TerminalManager } from './terminal';
import { SSHManager } from './ssh';
import { FileSystemManager } from './filesystem';
import { GitManager } from './git';
import { SettingsManager } from './settings';

let mainWindow: BrowserWindow | null = null;
let terminalManager: TerminalManager;
let sshManager: SSHManager;
let fsManager: FileSystemManager;
let gitManager: GitManager;
let settingsManager: SettingsManager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'JTerm',
    backgroundColor: '#1a1b26',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // In dev, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  terminalManager = new TerminalManager();
  sshManager = new SSHManager();
  fsManager = new FileSystemManager();
  gitManager = new GitManager();
  settingsManager = new SettingsManager();

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  terminalManager.cleanup();
  sshManager.cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function registerIpcHandlers() {
  // === Terminal IPC ===
  ipcMain.handle('terminal:create', (event, { id, cwd, shell }) => {
    const pty = terminalManager.create(id, cwd, shell);
    pty.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:onData', { id, data });
      }
    });
    return { pid: pty.pid };
  });

  ipcMain.handle('terminal:resize', (event, { id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
  });

  ipcMain.handle('terminal:write', (event, { id, data }) => {
    terminalManager.write(id, data);
  });

  ipcMain.handle('terminal:destroy', (event, { id }) => {
    terminalManager.destroy(id);
  });

  // === SSH IPC ===
  ipcMain.handle('ssh:connect', async (event, { id, host, port, username, auth, password, privateKey }) => {
    await sshManager.connect(id, { host, port, username, auth, password, privateKey });
    return { connected: true };
  });

  ipcMain.handle('ssh:createShell', (event, { id, termId, cols, rows }) => {
    const stream = sshManager.createShell(id, termId, { cols, rows });
    stream.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:onData', { id: termId, data });
      }
    });
    return { connected: true };
  });

  ipcMain.handle('ssh:writeShell', (event, { termId, data }) => {
    sshManager.writeShell(termId, data);
  });

  ipcMain.handle('ssh:resizeShell', (event, { termId, cols, rows }) => {
    sshManager.resizeShell(termId, cols, rows);
  });

  ipcMain.handle('ssh:listDir', async (event, { sessionId, remotePath }) => {
    return await sshManager.listDir(sessionId, remotePath);
  });

  ipcMain.handle('ssh:disconnect', async (event, { id }) => {
    await sshManager.disconnect(id);
  });

  ipcMain.handle('ssh:listConnections', () => {
    return sshManager.listConnections();
  });

  // === File System IPC ===
  ipcMain.handle('fs:listDir', async (event, { dirPath, showHidden }) => {
    return await fsManager.listDir(dirPath, showHidden);
  });

  ipcMain.handle('fs:getHome', () => {
    return fsManager.getHome();
  });

  ipcMain.handle('fs:getDrives', () => {
    return fsManager.getDrives();
  });

  ipcMain.handle('fs:stat', async (event, { filePath }) => {
    return await fsManager.stat(filePath);
  });

  // === Git IPC ===
  ipcMain.handle('git:status', async (event, { repoPath }) => {
    return await gitManager.status(repoPath);
  });

  ipcMain.handle('git:branches', async (event, { repoPath }) => {
    return await gitManager.branches(repoPath);
  });

  ipcMain.handle('git:log', async (event, { repoPath, maxCount }) => {
    return await gitManager.log(repoPath, maxCount);
  });

  ipcMain.handle('git:findRepo', async (event, { startPath }) => {
    return await gitManager.findRepo(startPath);
  });

  ipcMain.handle('git:checkout', async (event, { repoPath, branch }) => {
    return await gitManager.checkout(repoPath, branch);
  });

  // === Settings IPC ===
  ipcMain.handle('settings:get', () => {
    return settingsManager.get();
  });

  ipcMain.handle('settings:set', (event, updates) => {
    return settingsManager.set(updates);
  });

  ipcMain.handle('app:getPlatform', () => {
    return process.platform;
  });
}
