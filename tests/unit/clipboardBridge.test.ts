import { afterEach, describe, expect, it, vi } from 'vitest';
import packageMetadata from '../../package.json';

afterEach(() => {
  vi.doUnmock('electron');
  vi.resetModules();
});

async function importMainClipboardBridge() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.doMock('electron', () => ({
    app: {
      commandLine: { appendSwitch: vi.fn() },
      getVersion: vi.fn(() => '43.1.1'),
      requestSingleInstanceLock: vi.fn(() => false),
      quit: vi.fn(),
      on: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      setPath: vi.fn(),
      setAppUserModelId: vi.fn(),
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
  return {
    copyTerminalTextToClipboard: main.copyTerminalTextToClipboard,
    copyTextToClipboard: main.copyTextToClipboard,
    getApplicationVersion: main.getApplicationVersion,
    writeText,
  };
}

describe('main-process clipboard bridge', () => {
  it('reports JaneT package version instead of the development Electron runtime version', async () => {
    const { getApplicationVersion } = await importMainClipboardBridge();

    expect(getApplicationVersion()).toBe(packageMetadata.version);
  });

  it('writes a safe shell token to the Electron clipboard', async () => {
    const { copyTextToClipboard, writeText } = await importMainClipboardBridge();
    const token = "'/tmp/drag target' ";

    await expect(copyTextToClipboard(token)).resolves.toBe(true);
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

    await expect(copyTextToClipboard(unsafeText)).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('accepts the maximum expanded terminal token', async () => {
    const { copyTextToClipboard, writeText } = await importMainClipboardBridge();
    const token = 'a'.repeat(131_075);

    await expect(copyTextToClipboard(token)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(token);
  });

  it('writes multiline terminal selections without path-token restrictions', async () => {
    const { copyTerminalTextToClipboard, copyTextToClipboard, writeText } = await importMainClipboardBridge();
    const selection = 'first line\nsecond\tcolumn';

    await expect(copyTerminalTextToClipboard(selection)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(selection);
    await expect(copyTextToClipboard(selection)).resolves.toBe(false);
  });

  it.each([
    ['non-string data', { text: 'output' }],
    ['empty data', ''],
    ['oversized data', 'a'.repeat(1_048_577)],
  ])('rejects %s as terminal selection text', async (_label, value) => {
    const { copyTerminalTextToClipboard, writeText } = await importMainClipboardBridge();

    await expect(copyTerminalTextToClipboard(value)).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
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
      copyTerminalText(text: string): Promise<boolean>;
      copyText(text: string): Promise<boolean>;
    };

    await expect(api.copyText("'/tmp/drag target' ")).resolves.toBe(true);
    await expect(api.copyTerminalText('first line\nsecond line')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenNthCalledWith(1, 'app:copyText', "'/tmp/drag target' ");
    expect(invoke).toHaveBeenNthCalledWith(2, 'app:copyTerminalText', 'first line\nsecond line');
  });
});
