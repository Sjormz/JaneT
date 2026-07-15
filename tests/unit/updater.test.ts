import { beforeEach, describe, expect, it, vi } from 'vitest';

const updaterMocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const ipcHandle = vi.fn();
  const on = vi.fn((event: string, listener: (...args: any[]) => void) => {
    listeners.set(event, listener);
  });
  return { listeners, ipcHandle, on };
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
    quitAndInstall: vi.fn(),
  },
}));

import { initUpdater } from '../../src/main/updater';

describe('updater window lifecycle', () => {
  beforeEach(() => {
    updaterMocks.ipcHandle.mockClear();
    updaterMocks.on.mockClear();
    updaterMocks.listeners.clear();
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

    initUpdater(firstWindow);
    const ipcRegistrations = updaterMocks.ipcHandle.mock.calls.length;
    const eventRegistrations = updaterMocks.on.mock.calls.length;
    initUpdater(secondWindow);

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
});
