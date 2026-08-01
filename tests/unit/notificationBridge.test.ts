import { afterEach, describe, expect, it, vi } from 'vitest';

const validPayload = {
  durationMs: 10_000,
  outcome: 'success' as const,
  tabLabel: 'Build',
  paneLabel: 'Terminal',
  context: { kind: 'local' as const },
};

afterEach(() => {
  vi.doUnmock('electron');
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function loadMain(options: { enabled?: boolean; threshold?: number; supported?: boolean; focused?: boolean; minimized?: boolean; constructorFails?: boolean; e2e?: boolean } = {}) {
  vi.stubEnv('NODE_ENV', 'test');
  const handlers = new Map<string, Function>();
  const notificationOn = vi.fn();
  const notificationShow = vi.fn();
  const restore = vi.fn();
  const show = vi.fn();
  const focus = vi.fn();
  const webContents = {
    mainFrame: {}, isDestroyed: vi.fn(() => false), isLoadingMainFrame: vi.fn(() => false),
    setWindowOpenHandler: vi.fn(), on: vi.fn(), send: vi.fn(), loadURL: vi.fn(),
  };
  const window = {
    webContents, isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => options.focused ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false), restore, show, focus,
    on: vi.fn(), once: vi.fn(), loadURL: vi.fn(),
  };
  const setAppUserModelId = vi.fn();
  const Notification = vi.fn(function (this: any) {
    if (options.constructorFails) throw new Error('constructor failed');
    this.on = notificationOn;
    this.show = notificationShow;
  });
  (Notification as any).isSupported = vi.fn(() => options.supported ?? true);
  class BrowserWindow { constructor() { return window; } }
  if (options.e2e) vi.stubEnv('JANET_E2E_EVENTS_PATH', 'events.jsonl');
  vi.doMock('fs', async (original) => ({ ...(await original<typeof import('fs')>()), appendFileSync: vi.fn() }));
  vi.doMock('electron', () => ({
    app: { commandLine: { appendSwitch: vi.fn() }, getAppPath: vi.fn(() => '.'), getPath: vi.fn(() => '/tmp/janet-test'), getVersion: vi.fn(), isPackaged: false, requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(), on: vi.fn(), whenReady: vi.fn(() => Promise.resolve()), setPath: vi.fn(), setAppUserModelId },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }, net: { fetch: vi.fn() }, Menu: { setApplicationMenu: vi.fn() },
    BrowserWindow, Notification, clipboard: { writeText: vi.fn() }, dialog: { showMessageBox: vi.fn(), showErrorBox: vi.fn() }, shell: { openExternal: vi.fn() }, autoUpdater: { on: vi.fn() },
    ipcMain: { handle: vi.fn((channel: string, listener: Function) => handlers.set(channel, listener)), on: vi.fn() },
  }));
  const settings = await import('../../src/main/settings');
  vi.spyOn(settings.SettingsManager.prototype, 'get').mockReturnValue({ notificationsEnabled: options.enabled ?? true, notificationThresholdSeconds: options.threshold ?? 10 } as any);
  await import('../../src/main/index');
  await vi.waitFor(() => expect(handlers.has('notifications:command-completed')).toBe(true));
  const invoke = (payload: unknown, sender: unknown = webContents, senderFrame: unknown = webContents.mainFrame) =>
    Promise.resolve().then(() => handlers.get('notifications:command-completed')!({ sender, senderFrame }, payload));
  return { invoke, Notification, notificationOn, notificationShow, restore, show, focus, setAppUserModelId, webContents };
}

describe('main notification bridge', () => {
  it('shows one notification only when every delivery gate passes', async () => {
    const bridge = await loadMain();
    await expect(bridge.invoke(validPayload)).resolves.toBe(true);
    expect(bridge.Notification).toHaveBeenCalledOnce();
    expect(bridge.notificationShow).toHaveBeenCalledOnce();
  });

  it.each([
    ['disabled', { enabled: false }], ['below threshold', { threshold: 11 }],
    ['unsupported', { supported: false }], ['focused', { focused: true }],
  ])('suppresses when %s', async (_label, options) => {
    const bridge = await loadMain(options);
    await expect(bridge.invoke(validPayload)).resolves.toBe(false);
    expect(bridge.Notification).not.toHaveBeenCalled();
  });

  it.each([
    { ...validPayload, command: 'secret' }, { ...validPayload, output: 'secret' },
    { ...validPayload, durationMs: -1 }, { ...validPayload, tabLabel: '' },
    { ...validPayload, context: { kind: 'local', hostLabel: 'extra' } },
  ])('rejects malformed or extra-key payloads', async (payload) => {
    const bridge = await loadMain();
    await expect(bridge.invoke(payload)).rejects.toThrow(/invalid notification/i);
    expect(bridge.Notification).not.toHaveBeenCalled();
  });

  it('rejects accessor and throwing proxy-like values without invoking getters or constructing a notification', async () => {
    const bridge = await loadMain();
    const getter = vi.fn(() => 10_000);
    const accessorPayload = { ...validPayload };
    Object.defineProperty(accessorPayload, 'durationMs', { enumerable: true, get: getter });
    const throwingContext = new Proxy({ kind: 'local' }, {
      ownKeys() { throw new Error('context trap'); },
    });

    await expect(bridge.invoke(accessorPayload)).rejects.toThrow(/invalid notification/i);
    await expect(bridge.invoke({ ...validPayload, context: throwingContext })).rejects.toThrow(/invalid notification/i);
    expect(getter).not.toHaveBeenCalled();
    expect(bridge.Notification).not.toHaveBeenCalled();
  });

  it('quietly handles display failure', async () => {
    const bridge = await loadMain();
    bridge.notificationShow.mockImplementationOnce(() => { throw new Error('display failed'); });
    await expect(bridge.invoke(validPayload)).resolves.toBe(false);
  });

  it('quietly handles constructor failure', async () => {
    const bridge = await loadMain({ constructorFails: true });
    await expect(bridge.invoke(validPayload)).resolves.toBe(false);
  });

  it('restores, shows, and focuses the existing window on click', async () => {
    const bridge = await loadMain({ minimized: true });
    await bridge.invoke(validPayload);
    const click = bridge.notificationOn.mock.calls.find(([name]) => name === 'click')?.[1];
    click();
    expect(bridge.restore).toHaveBeenCalledOnce();
    expect(bridge.show).toHaveBeenCalled();
    expect(bridge.focus).toHaveBeenCalled();
  });

  it('rejects untrusted senders and configures the Windows app id', async () => {
    const bridge = await loadMain();
    await expect(bridge.invoke(validPayload, {})).rejects.toThrow(/untrusted/i);
    await expect(bridge.invoke(validPayload, bridge.webContents, {})).rejects.toThrow(/untrusted/i);
    expect(bridge.setAppUserModelId).toHaveBeenCalledWith('com.sjorm.janet');
  });
});

describe('preload notification bridge', () => {
  it('invokes only the command-completed channel with the exact payload', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, sendSync: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));
    await import('../../src/main/preload');
    const api = exposeInMainWorld.mock.calls[0][1];
    await expect(api.notifyCommandCompleted(validPayload)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('notifications:command-completed', validPayload);
  });
});
