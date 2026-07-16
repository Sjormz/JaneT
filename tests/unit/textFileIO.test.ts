import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSystemManager } from '../../src/main/filesystem';
import {
  MAX_TEXT_FILE_BYTES,
  type TextFileSnapshot,
  type WriteLocalTextFileRequest,
} from '../../src/shared/textFiles';

const tempDirectories: string[] = [];

async function makeTempDirectory(): Promise<string> {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'janet-text-file-'));
  tempDirectories.push(directory);
  return directory;
}

function writeRequest(
  snapshot: TextFileSnapshot,
  content: string,
  overrides: Partial<WriteLocalTextFileRequest> = {},
): WriteLocalTextFileRequest {
  return {
    requestedPath: snapshot.requestedPath,
    resolvedPath: snapshot.resolvedPath,
    expectedRevision: snapshot.revision,
    content,
    hasUtf8Bom: snapshot.hasUtf8Bom,
    ...overrides,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe('bounded local text-file IO', () => {
  it('rejects missing and unknown request fields before touching the filesystem', async () => {
    const manager = new FileSystemManager();

    await expect(manager.readTextFile({ filePath: '/tmp/example', extra: true })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
    await expect(manager.writeTextFile({})).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
  });

  it('reads UTF-8 BOM text through a canonical path and returns a byte-backed revision', async () => {
    const root = await makeTempDirectory();
    const target = path.join(root, 'target.txt');
    const requested = path.join(root, 'requested.txt');
    await fs.promises.writeFile(target, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('hello ☃', 'utf8'),
    ]));
    await fs.promises.symlink(target, requested);

    const result = await new FileSystemManager().readTextFile({ filePath: requested });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        requestedPath: requested,
        resolvedPath: await fs.promises.realpath(target),
        content: 'hello ☃',
        encoding: 'utf8',
        hasUtf8Bom: true,
        revision: expect.objectContaining({
          token: expect.stringMatching(/^[a-f0-9]{64}$/),
          size: Buffer.byteLength('\ufeffhello ☃', 'utf8'),
          mtime: expect.any(String),
        }),
      }),
    });
    if (result.ok && process.platform !== 'win32') {
      expect(result.value.revision.fileId).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
    }
  });

  it('returns structured errors for non-files, binary data, invalid UTF-8, and MAX+1 bytes', async () => {
    const root = await makeTempDirectory();
    const binary = path.join(root, 'binary.dat');
    const invalidUtf8 = path.join(root, 'invalid.txt');
    const tooLarge = path.join(root, 'large.txt');
    await Promise.all([
      fs.promises.writeFile(binary, Buffer.from([0x41, 0, 0x42])),
      fs.promises.writeFile(invalidUtf8, Buffer.from([0xc3, 0x28])),
      fs.promises.writeFile(tooLarge, Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 0x61)),
    ]);
    const manager = new FileSystemManager();

    const directoryResult = await manager.readTextFile({ filePath: root });
    const binaryResult = await manager.readTextFile({ filePath: binary });
    const utf8Result = await manager.readTextFile({ filePath: invalidUtf8 });
    const largeResult = await manager.readTextFile({ filePath: tooLarge });

    expect(directoryResult.ok ? undefined : directoryResult.error.code).toBe('NOT_FILE');
    expect(binaryResult.ok ? undefined : binaryResult.error.code).toBe('BINARY');
    expect(utf8Result.ok ? undefined : utf8Result.error.code).toBe('INVALID_UTF8');
    expect(largeResult.ok ? undefined : largeResult.error.code).toBe('TOO_LARGE');
  });

  it('atomically replaces a file, preserves its mode and BOM, and returns the new revision', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, 'save.txt');
    await fs.promises.writeFile(filePath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('before'),
    ]), { mode: 0o640 });
    await fs.promises.chmod(filePath, 0o640);
    const manager = new FileSystemManager();
    const opened = await manager.readTextFile({ filePath });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const before = await fs.promises.stat(filePath);

    const saved = await manager.writeTextFile(writeRequest(opened.value, 'after'));

    expect(saved.ok).toBe(true);
    const bytes = await fs.promises.readFile(filePath);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.subarray(3).toString('utf8')).toBe('after');
    const after = await fs.promises.stat(filePath);
    if (process.platform !== 'win32') {
      expect(after.mode & 0o777).toBe(0o640);
      expect(after.ino).not.toBe(before.ino);
    }
    if (saved.ok) {
      expect(saved.value.revision).toEqual(expect.objectContaining({
        token: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: 8,
      }));
      expect(saved.value.revision.token).not.toBe(opened.value.revision.token);
    }
    expect((await fs.promises.readdir(root)).some((name) => name.startsWith('.janet-save-'))).toBe(false);
  });

  it('detects external edits and only bypasses that revision mismatch when overwrite is explicit', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, 'conflict.txt');
    await fs.promises.writeFile(filePath, 'initial');
    const manager = new FileSystemManager();
    const opened = await manager.readTextFile({ filePath });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await fs.promises.writeFile(filePath, 'external');

    const conflict = await manager.writeTextFile(writeRequest(opened.value, 'mine'));
    expect(conflict.ok ? undefined : conflict.error.code).toBe('CONFLICT');
    await expect(fs.promises.readFile(filePath, 'utf8')).resolves.toBe('external');

    const overwritten = await manager.writeTextFile(writeRequest(opened.value, 'mine', { overwrite: true }));
    expect(overwritten.ok).toBe(true);
    await expect(fs.promises.readFile(filePath, 'utf8')).resolves.toBe('mine');
  });

  it.skipIf(process.platform === 'win32')(
    'does not let overwrite follow a requested symlink that was retargeted',
    async () => {
      const root = await makeTempDirectory();
      const first = path.join(root, 'first.txt');
      const second = path.join(root, 'second.txt');
      const requested = path.join(root, 'selected.txt');
      await Promise.all([
        fs.promises.writeFile(first, 'first'),
        fs.promises.writeFile(second, 'second'),
      ]);
      await fs.promises.symlink(first, requested);
      const manager = new FileSystemManager();
      const opened = await manager.readTextFile({ filePath: requested });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      await fs.promises.unlink(requested);
      await fs.promises.symlink(second, requested);

      const saved = await manager.writeTextFile(writeRequest(opened.value, 'replacement', { overwrite: true }));

      expect(saved.ok ? undefined : saved.error.code).toBe('CONFLICT');
      await expect(fs.promises.readFile(first, 'utf8')).resolves.toBe('first');
      await expect(fs.promises.readFile(second, 'utf8')).resolves.toBe('second');
    },
  );

  it('rejects hard-linked targets because atomic replacement would change their semantics', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, 'linked.txt');
    const otherLink = path.join(root, 'other-link.txt');
    await fs.promises.writeFile(filePath, 'original');
    await fs.promises.link(filePath, otherLink);
    const manager = new FileSystemManager();
    const opened = await manager.readTextFile({ filePath });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const saved = await manager.writeTextFile(writeRequest(opened.value, 'replacement', { overwrite: true }));

    expect(saved.ok ? undefined : saved.error.code).toBe('SAFE_REPLACE_UNAVAILABLE');
    await expect(fs.promises.readFile(filePath, 'utf8')).resolves.toBe('original');
    await expect(fs.promises.readFile(otherLink, 'utf8')).resolves.toBe('original');
  });

  it('cleans only its exclusive temporary file when atomic replacement is unavailable', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, 'rename-failure.txt');
    await fs.promises.writeFile(filePath, 'original');
    const manager = new FileSystemManager();
    const opened = await manager.readTextFile({ filePath });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const realUnlink = fs.promises.unlink.bind(fs.promises);
    const unlink = vi.spyOn(fs.promises, 'unlink').mockImplementation((candidate) => realUnlink(candidate));
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(
      Object.assign(new Error('cross-device rename'), { code: 'EXDEV' }),
    );

    const saved = await manager.writeTextFile(writeRequest(opened.value, 'replacement'));

    expect(saved.ok ? undefined : saved.error.code).toBe('SAFE_REPLACE_UNAVAILABLE');
    await expect(fs.promises.readFile(filePath, 'utf8')).resolves.toBe('original');
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(path.resolve(String(unlink.mock.calls[0][0]))).not.toBe(path.resolve(filePath));
    expect((await fs.promises.readdir(root)).some((name) => name.startsWith('.janet-save-'))).toBe(false);
  });

  it('serializes saves to the same canonical file so stale concurrent writers conflict', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, 'serialized.txt');
    await fs.promises.writeFile(filePath, 'initial');
    const manager = new FileSystemManager();
    const opened = await manager.readTextFile({ filePath });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const realRename = fs.promises.rename.bind(fs.promises);
    let releaseRename!: () => void;
    const renameGate = new Promise<void>((resolve) => { releaseRename = resolve; });
    let notifyRename!: () => void;
    const renameStarted = new Promise<void>((resolve) => { notifyRename = resolve; });
    const rename = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      notifyRename();
      await renameGate;
      return realRename(from, to);
    });

    const first = manager.writeTextFile(writeRequest(opened.value, 'first'));
    await renameStarted;
    const second = manager.writeTextFile(writeRequest(opened.value, 'second'));
    releaseRename();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok ? undefined : secondResult.error.code).toBe('CONFLICT');
    expect(rename).toHaveBeenCalledTimes(1);
    await expect(fs.promises.readFile(filePath, 'utf8')).resolves.toBe('first');
  });

  it('rejects encoded saves above the editor limit without creating a temporary file', async () => {
    const root = await makeTempDirectory();
    const filePath = path.join(root, 'too-large-save.txt');
    await fs.promises.writeFile(filePath, 'initial');
    const manager = new FileSystemManager();
    const opened = await manager.readTextFile({ filePath });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const saved = await manager.writeTextFile(
      writeRequest(opened.value, 'a'.repeat(MAX_TEXT_FILE_BYTES + 1)),
    );

    expect(saved.ok ? undefined : saved.error.code).toBe('TOO_LARGE');
    await expect(fs.promises.readFile(filePath, 'utf8')).resolves.toBe('initial');
    expect(await fs.promises.readdir(root)).toEqual(['too-large-save.txt']);
  });
});
