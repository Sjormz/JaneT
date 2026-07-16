import { describe, expect, it, vi } from 'vitest';
import {
  beginTerminalPathDrag,
  canDropTerminalPath,
  endTerminalPathDrag,
  formatTerminalPathForPaste,
  getActiveTerminalPathDrag,
  hasTerminalPathDrag,
  readTerminalPathDragData,
  resolveRepositoryPath,
  TERMINAL_PATH_MIME,
  type TerminalPathDragPayload,
} from '../../src/renderer/terminalPathDrag';

function dataTransferStub() {
  const values = new Map<string, string>();
  return {
    get types() { return Array.from(values.keys()); },
    effectAllowed: 'uninitialized',
    dropEffect: 'none',
    setData: vi.fn((type: string, value: string) => values.set(type, value)),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
  } as unknown as DataTransfer;
}

const localFile: TerminalPathDragPayload = {
  version: 1,
  path: '/workspace/JaneT/src/main.ts',
  entryKind: 'file',
  origin: 'explorer',
  filesystem: { kind: 'local' },
};

describe('terminal path drag payloads', () => {
  it('writes a typed payload plus a plain-text interoperability fallback', () => {
    const dataTransfer = dataTransferStub();

    expect(beginTerminalPathDrag(dataTransfer, localFile)).toBe(true);
    expect(getActiveTerminalPathDrag()).toEqual(localFile);
    expect(hasTerminalPathDrag(dataTransfer)).toBe(true);
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.getData('text/plain')).toBe(localFile.path);
    expect(readTerminalPathDragData(dataTransfer)).toEqual(localFile);
    endTerminalPathDrag();
    expect(getActiveTerminalPathDrag()).toBeNull();
  });

  it.each([
    '',
    '/tmp/file\nnext-command',
    '/tmp/file\rnext-command',
    '/tmp/file\0suffix',
  ])('rejects an unsafe path without exposing a JaneT drag type: %j', (path) => {
    const dataTransfer = dataTransferStub();

    expect(beginTerminalPathDrag(dataTransfer, { ...localFile, path })).toBe(false);
    expect(hasTerminalPathDrag(dataTransfer)).toBe(false);
    expect(dataTransfer.getData(TERMINAL_PATH_MIME)).toBe('');
  });

  it('formats safe and quoted paths as one paste token without submitting', () => {
    expect(formatTerminalPathForPaste('/repo/src/main.ts')).toBe('/repo/src/main.ts ');
    expect(formatTerminalPathForPaste("/repo/it's here.ts", 'posix'))
      .toBe("'/repo/it'\\''s here.ts' ");
    expect(formatTerminalPathForPaste("C:\\Jane's Files\\main.ts", 'powershell'))
      .toBe("'C:\\Jane''s Files\\main.ts' ");
    expect(formatTerminalPathForPaste('C:\\x’;Write-Output PWN;# ‘.txt', 'powershell'))
      .toBe("'C:\\x’’;Write-Output PWN;# ‘‘.txt' ");
    expect(formatTerminalPathForPaste("/repo/fish's file.ts", 'fish'))
      .toBe("'/repo/fish\\'s file.ts' ");
    expect(formatTerminalPathForPaste('/repo/back\\slash.ts', 'posix'))
      .toBe("'/repo/back\\slash.ts' ");
    expect(formatTerminalPathForPaste('C:\\repo\\main.ts', 'powershell'))
      .toBe("'C:\\repo\\main.ts' ");
    expect(formatTerminalPathForPaste('C:\\repo\\a,b.txt', 'powershell'))
      .toBe("'C:\\repo\\a,b.txt' ");
    expect(formatTerminalPathForPaste('//srv/project/main.ts'))
      .toBe('//srv/project/main.ts ');
    expect(formatTerminalPathForPaste('/repo/file\nwhoami')).toBeNull();
  });

  it('rejects malformed JSON and unsupported payload versions', () => {
    const invalidJson = dataTransferStub();
    invalidJson.setData(TERMINAL_PATH_MIME, '{not-json');
    expect(readTerminalPathDragData(invalidJson)).toBeNull();

    const unsupported = dataTransferStub();
    unsupported.setData(TERMINAL_PATH_MIME, JSON.stringify({ ...localFile, version: 2 }));
    expect(readTerminalPathDragData(unsupported)).toBeNull();
  });

  it('matches local paths locally and SSH paths only to the same session', () => {
    const remoteFile: TerminalPathDragPayload = {
      ...localFile,
      path: '/srv/project/src/main.ts',
      filesystem: { kind: 'ssh', sessionId: 'ssh-primary' },
    };

    expect(canDropTerminalPath(localFile, { kind: 'local' })).toBe(true);
    expect(canDropTerminalPath(localFile, { kind: 'ssh', sessionId: 'ssh-primary' })).toBe(false);
    expect(canDropTerminalPath(remoteFile, { kind: 'local' })).toBe(false);
    expect(canDropTerminalPath(remoteFile, { kind: 'ssh', sessionId: 'ssh-primary' })).toBe(true);
    expect(canDropTerminalPath(remoteFile, { kind: 'ssh', sessionId: 'ssh-other' })).toBe(false);
  });
});

describe('resolveRepositoryPath', () => {
  it.each([
    ['/repo', 'src/main.ts', '/repo/src/main.ts'],
    ['/repo', 'src/a\\b.ts', '/repo/src/a\\b.ts'],
    ['/repo', '\\leading.ts', '/repo/\\leading.ts'],
    ['/repo\\', 'src/main.ts', '/repo\\/src/main.ts'],
    ['/', 'src/main.ts', '/src/main.ts'],
    ['C:/repo', 'src/main.ts', 'C:/repo/src/main.ts'],
    ['C:\\repo', 'src/main.ts', 'C:\\repo\\src\\main.ts'],
    ['C:\\', 'src/main.ts', 'C:\\src\\main.ts'],
  ])('joins %s and %s using the repository separator', (repoPath, relativePath, expected) => {
    expect(resolveRepositoryPath(repoPath, relativePath)).toBe(expected);
  });

  it('leaves an already absolute status path unchanged', () => {
    expect(resolveRepositoryPath('/repo', '/other/file.ts')).toBe('/other/file.ts');
    expect(resolveRepositoryPath('C:\\repo', 'D:\\other\\file.ts')).toBe('D:\\other\\file.ts');
  });
});
