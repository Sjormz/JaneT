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

async function loadMain(options: { enabled?: boolean; threshold?: number; supported?: boolean; focused?: boolean; minimized?: boolean; constructorFails?: boolean; e2e?: boolean; selectedDirectory?: string } = {}) {
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
  const showOpenDialog = vi.fn().mockResolvedValue(options.selectedDirectory
    ? { canceled: false, filePaths: [options.selectedDirectory] }
    : { canceled: true, filePaths: [] });
  if (options.e2e) vi.stubEnv('JANET_E2E_EVENTS_PATH', 'events.jsonl');
  const writeFileSync = vi.fn();
  vi.doMock('fs', async (original) => ({
    ...(await original<typeof import('fs')>()),
    appendFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => {
      throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
    }),
    renameSync: vi.fn(),
    rmSync: vi.fn(),
    writeFileSync,
  }));
  vi.doMock('electron', () => ({
    app: { commandLine: { appendSwitch: vi.fn() }, getAppPath: vi.fn(() => '.'), getPath: vi.fn(() => '/tmp/janet-test'), getVersion: vi.fn(), isPackaged: false, requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(), on: vi.fn(), whenReady: vi.fn(() => Promise.resolve()), setPath: vi.fn(), setAppUserModelId },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }, net: { fetch: vi.fn() }, Menu: { setApplicationMenu: vi.fn() },
    BrowserWindow, Notification, clipboard: { writeText: vi.fn() }, dialog: { showMessageBox: vi.fn(), showOpenDialog, showErrorBox: vi.fn() }, shell: { openExternal: vi.fn() }, autoUpdater: { on: vi.fn() },
    ipcMain: { handle: vi.fn((channel: string, listener: Function) => handlers.set(channel, listener)), on: vi.fn() },
  }));
  const settings = await import('../../src/main/settings');
  const settingsGetSpy = vi.spyOn(settings.SettingsManager.prototype, 'get').mockReturnValue({ notificationsEnabled: options.enabled ?? true, notificationThresholdSeconds: options.threshold ?? 10 } as any);
  const settingsRecoveryStateSpy = vi.spyOn(settings.SettingsManager.prototype, 'getRecoveryState').mockReturnValue({ previousAvailable: true });
  const restorePreviousSpy = vi.spyOn(settings.SettingsManager.prototype, 'restorePrevious').mockReturnValue({ theme: 'dracula' } as any);
  const resetSettingsSpy = vi.spyOn(settings.SettingsManager.prototype, 'reset').mockReturnValue({ theme: 'tokyo-night' } as any);
  await import('../../src/main/index');
  await vi.waitFor(() => expect(handlers.has('notifications:command-completed')).toBe(true));
  const invoke = (payload: unknown, sender: unknown = webContents, senderFrame: unknown = webContents.mainFrame) =>
    Promise.resolve().then(() => handlers.get('notifications:command-completed')!({ sender, senderFrame }, payload));
  const setSettings = (updates: unknown) =>
    Promise.resolve().then(() => handlers.get('settings:set')!({ sender: webContents, senderFrame: webContents.mainFrame }, updates));
  const invokeChannel = (channel: string, payload?: unknown, sender: unknown = webContents, senderFrame: unknown = webContents.mainFrame) =>
    Promise.resolve().then(() => handlers.get(channel)!({ sender, senderFrame }, payload));
  return {
    invoke, invokeChannel, setSettings, writeFileSync, settingsGetSpy, settingsRecoveryStateSpy,
    restorePreviousSpy, resetSettingsSpy, Notification, notificationOn, notificationShow,
    restore, show, focus, setAppUserModelId, showOpenDialog, webContents,
  };
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

  it('rejects accessor-backed notification settings without invoking accessors or mutating settings', async () => {
    const bridge = await loadMain({ enabled: false, threshold: 10 });
    bridge.settingsGetSpy.mockRestore();
    let enabledCalls = 0;
    const enabled = {};
    Object.defineProperty(enabled, 'notificationsEnabled', {
      enumerable: true,
      get: () => (++enabledCalls < 4 ? true : 'attacker-enabled'),
    });
    const thresholdGetter = vi.fn(() => 20);
    const threshold = {};
    Object.defineProperty(threshold, 'notificationThresholdSeconds', { enumerable: true, get: thresholdGetter });

    await expect(bridge.setSettings(enabled)).rejects.toThrow(/invalid settings/i);
    await expect(bridge.setSettings(threshold)).rejects.toThrow(/invalid settings/i);
    expect(enabledCalls).toBe(0);
    expect(thresholdGetter).not.toHaveBeenCalled();
    expect(bridge.writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const)(
    'contains a throwing %s settings proxy without mutating settings',
    async (trap) => {
      const bridge = await loadMain({ enabled: false, threshold: 10 });
      bridge.settingsGetSpy.mockRestore();
      const updates = new Proxy({ notificationsEnabled: true }, { [trap]: () => { throw new Error(`${trap} trap`); } });

      await expect(bridge.setSettings(updates)).rejects.toThrow(/invalid settings/i);
      expect(bridge.writeFileSync).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['symbol key', Object.assign({ notificationsEnabled: true }, { [Symbol('hidden')]: true })],
    ['hidden key', Object.defineProperty({ notificationsEnabled: true }, 'hidden', { value: true })],
    ['extra key', { notificationsEnabled: true, extra: true }],
    ['custom prototype', Object.assign(Object.create({ polluted: true }), { notificationsEnabled: true })],
  ])('rejects a settings update with a %s', async (_label, updates) => {
    const bridge = await loadMain({ enabled: false, threshold: 10 });
    bridge.settingsGetSpy.mockRestore();

    await expect(bridge.setSettings(updates)).rejects.toThrow(/invalid settings/i);
    expect(bridge.writeFileSync).not.toHaveBeenCalled();
  });

  it('accepts a null-prototype notification settings update', async () => {
    const bridge = await loadMain({ enabled: false, threshold: 10 });
    bridge.settingsGetSpy.mockRestore();
    const updates = Object.assign(Object.create(null), {
      notificationsEnabled: true,
      notificationThresholdSeconds: 20,
    });

    await expect(bridge.setSettings(updates)).resolves.toMatchObject(updates);
    expect(bridge.writeFileSync).toHaveBeenCalledOnce();
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

  it('guards zero-payload settings recovery operations with the trusted sender boundary', async () => {
    const bridge = await loadMain();

    await expect(bridge.invokeChannel('settings:recovery-state', { ignored: true }))
      .resolves.toEqual({ previousAvailable: true });
    await expect(bridge.invokeChannel('settings:restore-previous', { ignored: true }))
      .resolves.toMatchObject({ theme: 'dracula' });
    await expect(bridge.invokeChannel('settings:reset', { ignored: true }))
      .resolves.toMatchObject({ theme: 'tokyo-night' });
    expect(bridge.settingsRecoveryStateSpy).toHaveBeenCalledWith();
    expect(bridge.restorePreviousSpy).toHaveBeenCalledWith();
    expect(bridge.resetSettingsSpy).toHaveBeenCalledWith();
    await expect(bridge.invokeChannel('settings:reset', undefined, bridge.webContents, {}))
      .rejects.toThrow(/untrusted/i);
  });

  it('selects only a native local directory and maps cancellation to null', async () => {
    const selected = await loadMain({ selectedDirectory: 'C:\\work\\sample-project' });
    await expect(selected.invokeChannel('app:selectLocalDirectory'))
      .resolves.toBe('C:\\work\\sample-project');
    expect(selected.showOpenDialog).toHaveBeenCalledWith(expect.anything(), {
      title: 'Open project',
      properties: ['openDirectory'],
    });
    await expect(selected.invokeChannel(
      'app:selectLocalDirectory', undefined, selected.webContents, {},
    )).rejects.toThrow(/untrusted/i);

    selected.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(selected.invokeChannel('app:selectLocalDirectory')).resolves.toBeNull();
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

  it('exposes zero-payload settings recovery operations', async () => {
    const invoke = vi.fn().mockResolvedValue({ previousAvailable: true });
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, sendSync: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));
    await import('../../src/main/preload');
    const api = exposeInMainWorld.mock.calls[0][1];

    await api.getSettingsRecoveryState();
    await api.restorePreviousSettings();
    await api.resetSettings();

    expect(invoke).toHaveBeenNthCalledWith(1, 'settings:recovery-state');
    expect(invoke).toHaveBeenNthCalledWith(2, 'settings:restore-previous');
    expect(invoke).toHaveBeenNthCalledWith(3, 'settings:reset');
  });

  it('exposes local-directory selection without a renderer payload', async () => {
    const invoke = vi.fn().mockResolvedValue('C:\\work\\sample-project');
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, sendSync: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() } }));
    await import('../../src/main/preload');
    const api = exposeInMainWorld.mock.calls[0][1];

    await expect(api.selectLocalDirectory()).resolves.toBe('C:\\work\\sample-project');
    expect(invoke).toHaveBeenCalledWith('app:selectLocalDirectory');
  });
});
