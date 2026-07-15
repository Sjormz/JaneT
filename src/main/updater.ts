import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import type { UpdateInfo, ProgressInfo } from 'builder-util-runtime';

// Log updater events to console for debugging
autoUpdater.logger = {
  info: (msg: string) => console.log(`[updater] ${msg}`),
  warn: (msg: string) => console.warn(`[updater] ${msg}`),
  error: (msg: string) => console.error(`[updater] ${msg}`),
  debug: (msg: string) => console.debug(`[updater] ${msg}`),
};

// Don't auto-download — let the user decide
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindowRef: BrowserWindow | null = null;
let updateInfo: UpdateInfo | null = null;
let suppressNoUpdateNotice = false;
let initialized = false;

function send(channel: string, ...args: unknown[]) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, ...args);
  }
}

export function initUpdater(mainWindow: BrowserWindow) {
  mainWindowRef = mainWindow;
  if (initialized) return;
  initialized = true;

  // Register IPC handlers for renderer-initiated update actions
  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] checkForUpdates failed:', message);
      send('update:error', { message });
      return { success: false, error: message };
    }
  });

  ipcMain.handle('update:download', async () => {
    if (!updateInfo) return { success: false, error: 'No update available' };
    try {
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  ipcMain.handle('update:install', () => {
    if (!updateInfo) return { success: false, error: 'No update downloaded' };
    setImmediate(() => {
      autoUpdater.quitAndInstall(true, true);
    });
    return { success: true };
  });

  // Register event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking-for-update');
    if (!suppressNoUpdateNotice) send('update:checking');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[updater] update-available:', info.version);
    updateInfo = info;
    send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[updater] update-not-available (current: ' + info.version + ')');
    updateInfo = null;
    if (!suppressNoUpdateNotice) send('update:not-available');
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send('update:download-progress', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update-downloaded:', info.version);
    send('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] error:', err.message);
    send('update:error', { message: err.message });
  });

  console.log('[updater] initialized');
}

/** Check for updates now (call after app is ready, optionally delayed). */
export function checkForUpdates(silent = false) {
  suppressNoUpdateNotice = silent;
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[updater] initial check failed:', message);
  }).finally(() => {
    suppressNoUpdateNotice = false;
  });
}
