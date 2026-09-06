import * as electron from 'electron';
import { readTerminalClipboard, clearTerminalClipboardImages } from './terminalClipboard';
import * as path from 'path';
import packageMetadata from '../../package.json';
import { TerminalManager } from './terminal';
import { AgentActivityBridge } from './agentActivityBridge';
import * as fs from 'node:fs';
import { SSHManager } from './ssh';
import { isAllowedExternalUrl } from './externalUrls';
import { FileSystemManager } from './filesystem';
import { GitManager } from './git';
import { SettingsManager } from './settings';
import { requireDirectory, createWorkspaceDirectory, renameWorkspaceDirectory } from './workspaceDirectories';
import { WorkspaceFileOperations } from './workspaceFileOperations';
import { sendRendererEvent } from './rendererEvents';
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
import { NativeTerminalCapacity } from './terminalCapacity';
import { registerSSHLocalForwardHandlers } from './sshLocalForwardIpc';
import { parseCommandNotificationPayload, type CommandNotificationPayload } from '../shared/commandNotifications';

let mainWindow: electron.BrowserWindow | null = null;
let initializeUpdaterForWindow: ((window: electron.BrowserWindow) => void) | null = null;
let terminalManager: TerminalManager;
let sshManager: SSHManager;
let fsManager: FileSystemManager;
let gitManager: GitManager;
let settingsManager: SettingsManager;
let workspaceLifecycle: WorkspaceLifecycleController;
let workspaceShutdownInProgress = false;
let quittingAfterWorkspaceStop = false;
const closePreparation = new WorkspaceClosePreparationCoordinator();

electron.protocol.registerSchemesAsPrivileged([RENDERER_SCHEME_REGISTRATION]);
const developmentApp = electron.app.isPackaged === false;
const notificationProtocol = developmentApp ? 'janet-dev' : 'janet';
if (process.platform === 'win32' && developmentApp) {
  // Electron creates notification shortcuts by app name. Keep development
  // registration separate without moving the existing settings profile.
  const userData = electron.app.getPath('userData');
  electron.app.setName('JaneT Development');
  electron.app.setPath('userData', userData);
}
electron.app.setAppUserModelId(developmentApp ? 'com.sjorm.janet.dev' : 'com.sjorm.janet');

export function notificationActivationKey(argv: string[]): string | undefined {
  const prefix = `${notificationProtocol}://notification/`;
  return argv.find((arg) => arg.startsWith(prefix) && /^[0-9]+-[a-z0-9]+$/.test(arg.slice(prefix.length)))?.slice(prefix.length);
}

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
let pendingNotificationKey: string | undefined;
if (!hasSingleInstanceLock) {
  electron.app.quit();
} else {
  electron.app.on('second-instance', (_event, argv: string[]) => {
    restoreRequestedBySecondInstance = true;
    pendingNotificationKey = notificationActivationKey(argv);
    if (!electron.app.isReady() || !workspaceLifecycle) return;
    restoreRequestedBySecondInstance = false;
    activateCommandNotification(pendingNotificationKey);
    pendingNotificationKey = undefined;
  });
}

function recordE2eEvent(event: Record<string, unknown>, timestamp = true): void {
  if (!e2eEventsPath) return;
  try {
    require('fs').appendFileSync(e2eEventsPath, `${JSON.stringify(timestamp ? { ts: Date.now(), ...event } : event)}\n`, 'utf-8');
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

export function getApplicationVersion(): string {
  return electron.app.isPackaged ? electron.app.getVersion() : packageMetadata.version;
}

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

async function stopWorkspaceResourcesAfterHidingWindow(): Promise<void> {
  const window = mainWindow;
  workspaceShutdownInProgress = true;
  if (window && !window.isDestroyed()) window.hide();
  try {
    await stopWorkspaceResources();
  } catch (error) {
    workspaceShutdownInProgress = false;
    if (window && !window.isDestroyed()) {
      window.show();
      window.focus();
    }
    throw error;
  }
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
  if (workspaceShutdownInProgress || quittingAfterWorkspaceStop) return;
  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  createWindow();
}

function notificationDecision(payload: CommandNotificationPayload): 'disabled' | 'below-threshold' | 'unsupported' | 'focused' | 'would-show' {
  const settings = settingsManager.get();
  if (!settings.notificationsEnabled) return 'disabled';
  if (payload.durationMs < settings.notificationThresholdSeconds * 1000) return 'below-threshold';
  if (!electron.Notification.isSupported()) return 'unsupported';
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return 'focused';
  return 'would-show';
}

const notificationTargets = new Map<string, NonNullable<CommandNotificationPayload['target']>>();
let notificationDeliveryError: string | null = null;
let notificationProtocolRegistered = false;
const agentActivityBridge = new AgentActivityBridge((id, event) => sendRendererEvent(mainWindow, 'terminal:agentActivity', { id, event }));
function activateCommandNotification(key?: string): void {
  showOrCreateWindow();
  const target = key && notificationTargets.get(key);
  if (target) sendRendererEvent(mainWindow, 'notifications:target', target);
}
const xmlText = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));

function deliverCommandNotification(value: unknown): boolean {
  const payload = parseCommandNotificationPayload(value);
  if (!payload) throw new Error('Invalid notification payload');
  const decision = notificationDecision(payload);
  if (e2eEventsPath) {
    recordE2eEvent({ type: 'notification:decision', decision, durationMs: payload.durationMs, outcome: payload.outcome, contextKind: payload.context.kind }, false);
    return decision === 'would-show';
  }
  if (decision !== 'would-show') return false;
  try {
    if (process.platform === 'win32' && !notificationProtocolRegistered) {
      // COM toast activation registers only electron.exe in development.
      // Protocol activation preserves the app argument and reaches our single instance.
      notificationProtocolRegistered = electron.app.setAsDefaultProtocolClient(notificationProtocol, process.execPath,
        developmentApp ? [path.resolve(electron.app.getAppPath())] : []);
      if (!notificationProtocolRegistered) throw new Error('Could not register notification activation');
    }
    const seconds = Math.round(payload.durationMs / 1000);
    const where = payload.context.kind === 'ssh' ? ` on ${payload.context.hostLabel}` : '';
    const title = payload.outcome === 'failure' ? 'Command failed' : payload.outcome === 'success' ? 'Command finished' : 'Command completed';
    const body = `${payload.tabLabel} · ${payload.paneLabel}${where} (${seconds}s)`;
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (payload.target) notificationTargets.set(key, payload.target);
    while (notificationTargets.size > 128) notificationTargets.delete(notificationTargets.keys().next().value!);
    const notification = new electron.Notification({ title, body,
      ...(process.platform === 'win32' ? { toastXml: `<toast activationType="protocol" launch="${notificationProtocol}://notification/${key}"><visual><binding template="ToastGeneric"><text>${xmlText(title)}</text><text>${xmlText(body)}</text></binding></visual></toast>` } : {}),
    });
    notification.on('failed', () => {
      notificationTargets.delete(key);
      notificationDeliveryError = 'Notification delivery failed. Check OS notification permissions and app installation.';
      console.warn(notificationDeliveryError);
    });
    notification.on('show', () => { notificationDeliveryError = null; });
    // Windows can activate a toast after its Notification instance has been
    // collected or after the app has restarted. Those activations are handled
    // centrally below; keep the per-notification listener for other platforms.
    if (process.platform !== 'win32') notification.on('click', () => activateCommandNotification(key));
    notification.show();
    return true;
  } catch {
    notificationDeliveryError = 'Notification delivery failed. Check OS notification permissions and app installation.';
    return false;
  }
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
  window.on('focus', () => sendRendererEvent(window, 'app:windowFocus', true));
  window.on('blur', () => sendRendererEvent(window, 'app:windowFocus', false));
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
  const terminalCapacity = new NativeTerminalCapacity();
  let agentHelper: string | undefined;
  try {
    const directory = path.join(electron.app.getPath('userData'), 'agent-activity');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const destination = path.join(directory, 'agent-cli.cjs');
    const contents = fs.readFileSync(path.join(__dirname, 'agent-cli.cjs'));
    if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(contents)) {
      if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Unexpected helper link');
      fs.writeFileSync(destination, contents, { mode: 0o600 });
    }
    agentHelper = destination;
  } catch { console.warn('Automatic agent setup unavailable; terminals remain usable.'); }
  terminalManager = new TerminalManager({ capacity: terminalCapacity, agentHelper });
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
    sendRendererEvent(mainWindow, 'ssh:onConnectionClosed', event);
  }, terminalCapacity);

  workspaceLifecycle = new WorkspaceLifecycleController({
    requestClosePreparation: requestRendererClosePreparation,
    stopAll: stopWorkspaceResourcesAfterHidingWindow,
    quit: () => {
      quittingAfterWorkspaceStop = true;
      workspaceShutdownInProgress = false;
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
  // On Windows, instance-level notification click listeners are not reliable
  // for notifications that outlive their JavaScript objects (or the process).
  // This API also receives a queued activation when JaneT was launched by a
  // notification click, so it must be registered after mainWindow exists.
  if (process.platform === 'win32') {
    electron.Notification.handleActivation((details) => activateCommandNotification(details?.arguments));
  }
  if (restoreRequestedBySecondInstance) {
    restoreRequestedBySecondInstance = false;
    activateCommandNotification(pendingNotificationKey);
    pendingNotificationKey = undefined;
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
  agentActivityBridge.close();
  fsManager.cleanup();
  sshManager.cleanup();
  if (process.platform !== 'darwin') {
    electron.app.quit();
  }
});

function registerIpcHandlers() {
  const workspaceLifecycle = new WorkspaceFileOperations({
    getSettings: () => settingsManager.get(),
    setSession: (session) => { settingsManager.set({ session }); },
    trash: (directory) => electron.shell.trashItem(directory),
    release: (directory) => fsManager.releaseDirectory(directory),
    protectedPaths: [electron.app.getPath('home'), electron.app.getPath('userData'), electron.app.getAppPath()],
  });
  const isTrustedSender = (event: electron.IpcMainEvent | electron.IpcMainInvokeEvent): boolean => {
    const window = mainWindow;
    return Boolean(
      window && !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    );
  };
  const handle = (
    channel: string,
    listener: (event: electron.IpcMainInvokeEvent, ...args: any[]) => any,
  ): void => {
    electron.ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        throw new Error(`Rejected untrusted IPC sender for ${channel}`);
      }
      return listener(event, ...args);
    });
  };

  electron.ipcMain.on('app:copyTerminalText', (event, text: unknown) => {
    event.returnValue = isTrustedSender(event) && copyTerminalTextToClipboard(text);
  });

  electron.ipcMain.on('terminal:acknowledgeOutput', (event, acknowledgement: unknown) => {
    if (!isTrustedSender(event) || !acknowledgement || typeof acknowledgement !== 'object') return;
    const { source, id, generation, sequence } = acknowledgement as Record<string, unknown>;
    if (
      (source !== 'local' && source !== 'ssh')
      || typeof id !== 'string'
      || !Number.isSafeInteger(generation)
      || !Number.isSafeInteger(sequence)
    ) return;
    if (source === 'local') {
      terminalManager.acknowledgeOutput(id, generation as number, sequence as number);
    } else {
      sshManager.acknowledgeOutput(id, generation as number, sequence as number);
    }
  });

  // === Terminal IPC ===
  handle('app:readTerminalClipboard', readTerminalClipboard);
  electron.app.on('will-quit', () => {
    try { clearTerminalClipboardImages(); } catch { /* OS temp cleanup can remove files still in use. */ }
  });

  handle('terminal:create', async (event, { id, cwd, shell, startupCommands }) => {
    const activityEnv = await agentActivityBridge.environment(id).catch(() => {
      console.warn('Agent activity bridge unavailable; shell terminal remains usable.');
      return {};
    });
    let pty;
    try { pty = terminalManager.create(id, cwd, shell, (data, output) => {
      return sendRendererEvent(mainWindow, 'terminal:onData', { source: 'local', id, data, ...output });
    }, startupCommands, (exit) => {
      agentActivityBridge.remove(id);
      sendRendererEvent(mainWindow, 'terminal:onExit', { id, ...exit });
    }, activityEnv); } catch (error) { agentActivityBridge.remove(id); throw error; }
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
    agentActivityBridge.remove(id);
    terminalManager.destroy(id);
  });

  // === SSH IPC ===
  handle('ssh:connect', async (event, { id, host, port, username, auth, password, privateKey, jumpHost }) => {
    recordE2eEvent({ type: 'ssh:connect:start', id, host, port, username });
    await sshManager.connect(id, { host, port, username, auth, password, privateKey, jumpHost });
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
    shell.onData((data, output) => {
      return sendRendererEvent(mainWindow, 'terminal:onData', { source: 'ssh', id: termId, data, ...output });
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

  registerSSHLocalForwardHandlers(handle, sshManager);

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

  handle('git:discard', async (event, { repoPath, paths }) => {
    return await gitManager.discard(repoPath, paths);
  });

  handle('git:deleteUntracked', async (event, { repoPath, path }) => {
    return await gitManager.deleteUntracked(repoPath, path);
  });

  handle('git:diff', async (event, { repoPath, filePath, side, originalPath }) => {
    return await gitManager.diff(repoPath, filePath, side, originalPath);
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

  handle('settings:recovery-state', () => settingsManager.getRecoveryState());
  handle('settings:restore-previous', () => settingsManager.restorePrevious());
  handle('settings:reset', () => settingsManager.reset());

  handle('notifications:command-completed', (_event, payload: unknown) => deliverCommandNotification(payload));
  handle('notifications:status', () => notificationDeliveryError ?? (electron.Notification.isSupported() ? null : 'Desktop notifications are unavailable on this system.'));
  handle('app:isWindowFocused', () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()));

  handle('app:getPlatform', () => {
    return process.platform;
  });

  handle('app:getVersion', () => {
    return getApplicationVersion();
  });

  handle('app:selectLocalDirectory', async () => {
    if (!mainWindow) return null;
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      title: 'Choose folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handle('workspace:directory', async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid directory request');
    const { parent, name } = request as { parent?: unknown; name?: unknown };
    return name === undefined ? requireDirectory(parent) : createWorkspaceDirectory(parent, name);
  });
  handle('workspace:renameDirectory', async (_event, request: unknown) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid rename request');
    const { source, name } = request as { source?: unknown; name?: unknown };
    const directory = await requireDirectory(source);
    fsManager.releaseDirectory(directory);
    return renameWorkspaceDirectory(source, name);
  });
  handle('workspace:lifecycle', (_event, request: unknown) => workspaceLifecycle.run(request));

  handle('app:openExternal', async (event, url: unknown) => {
    if (typeof url !== 'string' || !isAllowedExternalUrl(url)) return false;
    await electron.shell.openExternal(url);
    return true;
  });

  handle('app:copyText', (event, text: unknown) => {
    return copyTextToClipboard(text);
  });

  handle('app:copyDiagnostics', () => {
    try {
      electron.clipboard.writeText([
        `JaneT version: ${getApplicationVersion()}`,
        `OS: ${process.platform}`,
        `Architecture: ${process.arch}`,
        `Mode: ${electron.app.isPackaged ? 'packaged' : 'development'}`,
        `Electron version: ${process.versions.electron}`,
        `Notifications: ${electron.Notification.isSupported() ? 'supported' : 'unsupported'}`,
      ].join('\n'));
      return true;
    } catch {
      return false;
    }
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
