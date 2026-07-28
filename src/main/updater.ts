import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { UpdateInfo, ProgressInfo } from 'builder-util-runtime';
import { sendRendererEvent } from './rendererEvents';

// Log updater events to console for debugging
autoUpdater.logger = {
  info: (msg: string) => console.log(`[updater] ${msg}`),
  warn: (msg: string) => console.warn(`[updater] ${msg}`),
  error: (msg: string) => console.error(`[updater] ${msg}`),
  debug: (msg: string) => console.debug(`[updater] ${msg}`),
};

// Don't auto-download — let the user decide
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let mainWindowRef: BrowserWindow | null = null;
let prepareForInstallRef: (() => Promise<boolean>) | null = null;
let updateInfo: UpdateInfo | null = null;
let downloadedVersion: string | null = null;
let installRequest: Promise<{ success: boolean; error?: string; cancelled?: boolean }> | null = null;
let checkRequest: Promise<unknown> | null = null;
let downloadRequest: Promise<{ success: boolean; error?: string }> | null = null;
let downloadVersion: string | null = null;
let suppressNoUpdateNotice = false;
let initialized = false;

function send(channel: string, ...args: unknown[]) {
  sendRendererEvent(mainWindowRef, channel, ...args);
}

function handle(channel: string, listener: () => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
    const window = mainWindowRef;
    if (
      !window || window.isDestroyed()
      || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame
    ) throw new Error(`Rejected untrusted IPC sender for ${channel}`);
    return listener();
  });
}

function requestUpdateCheck(silent: boolean): Promise<unknown> {
  if (checkRequest) {
    if (!silent) suppressNoUpdateNotice = false;
    return checkRequest;
  }
  suppressNoUpdateNotice = silent;
  const request = autoUpdater.checkForUpdates().finally(() => {
    if (checkRequest === request) {
      checkRequest = null;
      suppressNoUpdateNotice = false;
    }
  });
  checkRequest = request;
  return request;
}

export function initUpdater(
  mainWindow: BrowserWindow,
  prepareForInstall: () => Promise<boolean>,
) {
  mainWindowRef = mainWindow;
  prepareForInstallRef = prepareForInstall;
  if (initialized) return;
  initialized = true;

  // Register IPC handlers for renderer-initiated update actions
  handle('update:check', async () => {
    try {
      await requestUpdateCheck(false);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] checkForUpdates failed:', message);
      send('update:error', { message });
      return { success: false, error: message };
    }
  });

  handle('update:download', async () => {
    if (!updateInfo) return { success: false, error: 'No update available' };
    const requestedVersion = updateInfo.version;
    if (downloadRequest) {
      if (downloadVersion !== requestedVersion) {
        return { success: false, error: 'Another update download is already in progress' };
      }
      return downloadRequest;
    }
    const request = (async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    })();
    downloadRequest = request;
    downloadVersion = requestedVersion;
    void request.then(() => {
      if (downloadRequest === request) {
        downloadRequest = null;
        downloadVersion = null;
      }
    });
    return request;
  });

  handle('update:install', async () => {
    if (installRequest) return installRequest;
    if (!updateInfo || downloadedVersion !== updateInfo.version) {
      return { success: false, error: 'No update downloaded' };
    }
    const requestedVersion = updateInfo.version;
    if (!prepareForInstallRef) {
      return { success: false, error: 'Update shutdown protection is unavailable' };
    }
    let installScheduled = false;
    const request = (async () => {
      try {
        const canInstall = await prepareForInstallRef!();
        if (!canInstall) return { success: false, cancelled: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[updater] failed to prepare workspace for install:', message);
        return { success: false, error: message };
      }
      if (updateInfo?.version !== requestedVersion || downloadedVersion !== requestedVersion) {
        return { success: false, error: 'No update downloaded' };
      }
      installScheduled = true;
      setImmediate(() => {
        try {
          autoUpdater.quitAndInstall(true, true);
        } catch (error) {
          console.error('[updater] quitAndInstall failed:', error);
          if (installRequest === request) installRequest = null;
        }
      });
      return { success: true };
    })();
    installRequest = request;
    void request.then(() => {
      if (!installScheduled && installRequest === request) installRequest = null;
    });
    return request;
  });

  // Register event handlers
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking-for-update');
    if (!suppressNoUpdateNotice) send('update:checking');
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[updater] update-available:', info.version);
    updateInfo = info;
    downloadedVersion = null;
    send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[updater] update-not-available (current: ' + info.version + ')');
    updateInfo = null;
    downloadedVersion = null;
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
    if (info.version !== updateInfo?.version) return;
    downloadedVersion = info.version;
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
  void requestUpdateCheck(silent).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[updater] initial check failed:', message);
  });
}
