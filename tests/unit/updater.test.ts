import { beforeEach, describe, expect, it, vi } from 'vitest';

const updaterMocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcHandle = vi.fn((channel: string, handler: (...args: any[]) => any) => {
    handlers.set(channel, handler);
  });
  const on = vi.fn((event: string, listener: (...args: any[]) => void) => {
    listeners.set(event, listener);
  });
  const quitAndInstall = vi.fn();
  const checkForUpdates = vi.fn().mockResolvedValue(undefined);
  const downloadUpdate = vi.fn().mockResolvedValue(undefined);
  return { listeners, handlers, ipcHandle, on, quitAndInstall, checkForUpdates, downloadUpdate };
});

vi.mock('electron', () => ({
  ipcMain: { handle: updaterMocks.ipcHandle },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: updaterMocks.on,
    checkForUpdates: updaterMocks.checkForUpdates,
    downloadUpdate: updaterMocks.downloadUpdate,
    quitAndInstall: updaterMocks.quitAndInstall,
  },
}));

type UpdaterModule = typeof import('../../src/main/updater');
let checkForUpdates: UpdaterModule['checkForUpdates'];
let initUpdater: UpdaterModule['initUpdater'];

describe('updater window lifecycle', () => {
  beforeEach(async () => {
    updaterMocks.listeners.clear();
    updaterMocks.handlers.clear();
    updaterMocks.ipcHandle.mockClear();
    updaterMocks.on.mockClear();
    updaterMocks.quitAndInstall.mockReset();
    updaterMocks.checkForUpdates.mockReset().mockResolvedValue(undefined);
    updaterMocks.downloadUpdate.mockReset().mockResolvedValue(undefined);
    vi.resetModules();
    ({ checkForUpdates, initUpdater } = await import('../../src/main/updater'));
  });

  it('retargets events to a recreated window without registering handlers twice', () => {
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    const firstWindow = {
      isDestroyed: () => false,
      webContents: { send: firstSend },
    } as any;
    const secondWindow = {
      isDestroyed: () => false,
      webContents: { send: secondSend },
    } as any;

    initUpdater(firstWindow, async () => true);
    const ipcRegistrations = updaterMocks.ipcHandle.mock.calls.length;
    const eventRegistrations = updaterMocks.on.mock.calls.length;
    initUpdater(secondWindow, async () => true);

    expect(updaterMocks.ipcHandle).toHaveBeenCalledTimes(ipcRegistrations);
    expect(updaterMocks.on).toHaveBeenCalledTimes(eventRegistrations);
    updaterMocks.listeners.get('update-available')?.({
      version: '9.9.9',
      releaseDate: '2026-07-14',
      releaseNotes: null,
    });
    expect(firstSend).not.toHaveBeenCalled();
    expect(secondSend).toHaveBeenCalledWith('update:available', expect.objectContaining({ version: '9.9.9' }));
  });

  it('coalesces concurrent update downloads into one native request', async () => {
    let release!: () => void;
    updaterMocks.downloadUpdate.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, async () => true);
    updaterMocks.listeners.get('update-available')?.({ version: '9.9.9' });

    const download = updaterMocks.handlers.get('update:download')!;
    const first = download();
    const second = download();

    expect(updaterMocks.downloadUpdate).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([{ success: true }, { success: true }]);
  });

  it('does not coalesce a newer version into an older in-flight download', async () => {
    let release!: () => void;
    updaterMocks.downloadUpdate.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, async () => true);
    updaterMocks.listeners.get('update-available')?.({ version: '9.9.9' });
    const download = updaterMocks.handlers.get('update:download')!;
    const first = download();

    updaterMocks.listeners.get('update-available')?.({ version: '10.0.0' });
    await expect(download()).resolves.toEqual({
      success: false, error: 'Another update download is already in progress',
    });
    expect(updaterMocks.downloadUpdate).toHaveBeenCalledOnce();

    release();
    await expect(first).resolves.toEqual({ success: true });
  });

  it('does not install when workspace shutdown is cancelled', async () => {
    const prepare = vi.fn().mockResolvedValue(false);
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '9.9.9' });
    updaterMocks.listeners.get('update-downloaded')?.({ version: '9.9.9' });

    const result = await updaterMocks.handlers.get('update:install')?.();

    expect(prepare).toHaveBeenCalledOnce();
    expect(result).toEqual({ success: false, cancelled: true });
    expect(updaterMocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('installs only after workspace shutdown succeeds', async () => {
    const prepare = vi.fn().mockResolvedValue(true);
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '9.9.9' });
    updaterMocks.listeners.get('update-downloaded')?.({ version: '9.9.9' });

    const result = await updaterMocks.handlers.get('update:install')?.();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(result).toEqual({ success: true });
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('does not install when workspace shutdown fails', async () => {
    const prepare = vi.fn().mockRejectedValue(new Error('process would not stop'));
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '9.9.9' });
    updaterMocks.listeners.get('update-downloaded')?.({ version: '9.9.9' });

    const result = await updaterMocks.handlers.get('update:install')?.();

    expect(result).toEqual({ success: false, error: 'process would not stop' });
    expect(updaterMocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('does not stop the workspace before an available update finishes downloading', async () => {
    const prepare = vi.fn().mockResolvedValue(true);
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '10.0.0' });

    const result = await updaterMocks.handlers.get('update:install')?.();

    expect(result).toEqual({ success: false, error: 'No update downloaded' });
    expect(prepare).not.toHaveBeenCalled();
    expect(updaterMocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('ignores a stale downloaded event for an older available version', async () => {
    const prepare = vi.fn().mockResolvedValue(true);
    const send = vi.fn();
    initUpdater({ isDestroyed: () => false, webContents: { send } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '10.0.0' });
    updaterMocks.listeners.get('update-available')?.({ version: '11.0.0' });
    send.mockClear();
    updaterMocks.listeners.get('update-downloaded')?.({ version: '10.0.0' });

    const result = await updaterMocks.handlers.get('update:install')?.();

    expect(result).toEqual({ success: false, error: 'No update downloaded' });
    expect(send).not.toHaveBeenCalledWith('update:downloaded', expect.anything());
    expect(prepare).not.toHaveBeenCalled();
    expect(updaterMocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('coalesces concurrent install requests into one shutdown transaction', async () => {
    let release!: (value: boolean) => void;
    const prepare = vi.fn(() => new Promise<boolean>((resolve) => { release = resolve; }));
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '12.0.0' });
    updaterMocks.listeners.get('update-downloaded')?.({ version: '12.0.0' });

    const install = updaterMocks.handlers.get('update:install')!;
    const first = install();
    const second = install();
    expect(prepare).toHaveBeenCalledOnce();
    release(true);

    await expect(Promise.all([first, second])).resolves.toEqual([{ success: true }, { success: true }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('keeps install requests coalesced until the scheduled install executes', async () => {
    const prepare = vi.fn().mockResolvedValue(true);
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '13.0.0' });
    updaterMocks.listeners.get('update-downloaded')?.({ version: '13.0.0' });

    const install = updaterMocks.handlers.get('update:install')!;
    await expect(install()).resolves.toEqual({ success: true });
    await expect(install()).resolves.toEqual({ success: true });

    expect(prepare).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledOnce();

    await expect(install()).resolves.toEqual({ success: true });
    expect(prepare).toHaveBeenCalledOnce();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledOnce();

    updaterMocks.listeners.get('update-available')?.({ version: '14.0.0' });
    await expect(install()).resolves.toEqual({ success: true });
    expect(prepare).toHaveBeenCalledOnce();
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('allows installation to retry after quitAndInstall throws synchronously', async () => {
    updaterMocks.quitAndInstall.mockImplementationOnce(() => { throw new Error('installer failed'); });
    const prepare = vi.fn().mockResolvedValue(true);
    initUpdater({ isDestroyed: () => false, webContents: { send: vi.fn() } } as any, prepare);
    updaterMocks.listeners.get('update-available')?.({ version: '15.0.0' });
    updaterMocks.listeners.get('update-downloaded')?.({ version: '15.0.0' });
    const install = updaterMocks.handlers.get('update:install')!;

    await expect(install()).resolves.toEqual({ success: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(install()).resolves.toEqual({ success: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledTimes(2);
  });

  it('shows the result when a manual check joins a silent startup check', async () => {
    let resolveCheck!: () => void;
    updaterMocks.checkForUpdates.mockReturnValue(new Promise<void>((resolve) => { resolveCheck = resolve; }));
    const send = vi.fn();
    initUpdater({ isDestroyed: () => false, webContents: { send } } as any, async () => true);

    checkForUpdates(true);
    const manualCheck = updaterMocks.handlers.get('update:check')?.();
    updaterMocks.listeners.get('update-not-available')?.({ version: '0.5.2' });

    expect(send).toHaveBeenCalledWith('update:not-available');
    expect(updaterMocks.checkForUpdates).toHaveBeenCalledOnce();
    resolveCheck();
    await expect(manualCheck).resolves.toEqual({ success: true });
  });
});
