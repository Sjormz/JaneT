import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('electron');
  vi.resetModules();
});

async function importMainClipboardBridge() {
  const writeText = vi.fn();
  vi.doMock('electron', () => ({
    app: {
      commandLine: { appendSwitch: vi.fn() },
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      setPath: vi.fn(),
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
    },
    clipboard: { writeText },
    dialog: {
      showMessageBox: vi.fn(),
      showErrorBox: vi.fn(),
    },
    shell: { openExternal: vi.fn() },
  }));
  const main = await import('../../src/main/index');
  return { copyTextToClipboard: main.copyTextToClipboard, writeText };
}

describe('main-process clipboard bridge', () => {
  it('writes a safe shell token to the Electron clipboard', async () => {
    const { copyTextToClipboard, writeText } = await importMainClipboardBridge();
    const token = "'/tmp/drag target' ";

    expect(copyTextToClipboard(token)).toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(token);
  });

  it.each([
    ['non-string data', { text: '/tmp/file' }],
    ['empty data', ''],
    ['oversized data', 'a'.repeat(131_076)],
    ['a newline', '/tmp/file\n'],
    ['a tab', '/tmp/file\t'],
    ['a delete control', `/tmp/file${String.fromCharCode(0x7f)}`],
    ['a C1 control', `/tmp/file${String.fromCharCode(0x85)}`],
    ['a Unicode line separator', `/tmp/file${String.fromCharCode(0x2028)}`],
  ])('rejects %s without writing', async (_label, unsafeText) => {
    const { copyTextToClipboard, writeText } = await importMainClipboardBridge();

    expect(copyTextToClipboard(unsafeText)).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('accepts the maximum expanded terminal token', async () => {
    const { copyTextToClipboard, writeText } = await importMainClipboardBridge();
    const token = 'a'.repeat(131_075);

    expect(copyTextToClipboard(token)).toBe(true);
    expect(writeText).toHaveBeenCalledWith(token);
  });
});

describe('preload clipboard bridge', () => {
  it('exposes copyText through the guarded app IPC channel', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const exposeInMainWorld = vi.fn();
    vi.doMock('electron', () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: {
        invoke,
        on: vi.fn(),
        removeListener: vi.fn(),
      },
    }));

    await import('../../src/main/preload');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      copyText(text: string): Promise<boolean>;
    };

    await expect(api.copyText("'/tmp/drag target' ")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('app:copyText', "'/tmp/drag target' ");
  });
});
