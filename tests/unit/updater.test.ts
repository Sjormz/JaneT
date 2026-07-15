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
  return { listeners, handlers, ipcHandle, on, quitAndInstall };
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
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: updaterMocks.quitAndInstall,
  },
}));

import { initUpdater } from '../../src/main/updater';

describe('updater window lifecycle', () => {
  beforeEach(() => {
    updaterMocks.ipcHandle.mockClear();
    updaterMocks.on.mockClear();
    updaterMocks.quitAndInstall.mockClear();
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
});
