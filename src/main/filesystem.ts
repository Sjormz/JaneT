import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import type { FileHandle } from 'fs/promises';
import type { FileEntry } from '../shared/files';
import {
  MAX_TEXT_FILE_BYTES,
  isTextFileRevision,
  textFileFailure,
  type ReadLocalTextFileRequest,
  type TextFileResult,
  type TextFileSnapshot,
  type TextFileWriteValue,
  type WriteLocalTextFileRequest,
} from '../shared/textFiles';
import {
  decodeTextFile,
  encodeTextFile,
  revisionsMatch,
  textFileRevision,
} from './textFileCodec';

export type { FileEntry } from '../shared/files';

interface DirectorySnapshot {
  entries: Map<string, FileEntry>;
  dirtyNames: Set<string>;
  dirtyAll: boolean;
  watcher: DirectoryWatcher | null;
  watcherStarted: boolean;
  lastFullStatAt: number;
  lastUsedAt: number;
}

export type DirectoryWatchListener = (
  eventType: 'rename' | 'change',
  filename: string | Buffer | null,
) => void;

export interface DirectoryWatcher {
  on(event: 'error', listener: (error: Error) => void): DirectoryWatcher;
  close(): void;
}

export type WatchDirectory = (directory: string, listener: DirectoryWatchListener) => DirectoryWatcher;

const DEFAULT_FULL_STAT_INTERVAL_MS = 60_000;
const MAX_DIRECTORY_SNAPSHOTS = 32;
const TEXT_FILE_READ_BUFFER_BYTES = MAX_TEXT_FILE_BYTES + 1;
const TEXT_FILE_TEMP_ATTEMPTS = 8;

interface OpenedLocalTextFile {
  snapshot: TextFileSnapshot;
  stats: fs.BigIntStats;
}

interface PreparedTextFile {
  handle: FileHandle | null;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

function hasOwnKeys(value: Record<string, unknown>, requiredKeys: readonly string[]): boolean {
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isUsablePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function validateReadTextFileRequest(value: unknown): TextFileResult<ReadLocalTextFileRequest> {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['filePath'])
    || !hasOwnKeys(value, ['filePath'])
    || !isUsablePath(value.filePath)
  ) {
    return textFileFailure('INVALID_REQUEST', 'A file path is required to open a local text file.');
  }
  return { ok: true, value: { filePath: value.filePath } };
}

function validateWriteTextFileRequest(value: unknown): TextFileResult<WriteLocalTextFileRequest> {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      'requestedPath',
      'resolvedPath',
      'expectedRevision',
      'content',
      'hasUtf8Bom',
      'overwrite',
    ])
    || !hasOwnKeys(value, [
      'requestedPath',
      'resolvedPath',
      'expectedRevision',
      'content',
      'hasUtf8Bom',
    ])
    || !isUsablePath(value.requestedPath)
    || !isUsablePath(value.resolvedPath)
    || !path.isAbsolute(value.requestedPath)
    || !path.isAbsolute(value.resolvedPath)
    || !isRecord(value.expectedRevision)
    || !hasOnlyKeys(value.expectedRevision, ['token', 'size', 'mtime', 'fileId'])
    || !hasOwnKeys(value.expectedRevision, ['token', 'size', 'mtime'])
    || !isTextFileRevision(value.expectedRevision)
    || typeof value.content !== 'string'
    || typeof value.hasUtf8Bom !== 'boolean'
    || (value.overwrite !== undefined && typeof value.overwrite !== 'boolean')
  ) {
    return textFileFailure(
      'INVALID_REQUEST',
      'A complete local text-file snapshot and UTF-8 content are required to save.',
    );
  }
  return {
    ok: true,
    value: {
      requestedPath: value.requestedPath,
      resolvedPath: value.resolvedPath,
      expectedRevision: value.expectedRevision,
      content: value.content,
      hasUtf8Bom: value.hasUtf8Bom,
      ...(value.overwrite === undefined ? {} : { overwrite: value.overwrite }),
    },
  };
}

function textFileFailureFromError<T>(error: unknown, action: string): TextFileResult<T> {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return textFileFailure('NOT_FOUND', `The local file could not be found while ${action}.`);
  }
  if (code === 'EISDIR') {
    return textFileFailure('NOT_FILE', `The selected path is not a regular file and cannot be ${action}.`);
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return textFileFailure('PERMISSION_DENIED', `JaneT does not have permission to ${action} this file.`);
  }
  if (code === 'ELOOP') {
    return textFileFailure('CONFLICT', 'The selected path changed while JaneT was accessing it.');
  }
  return textFileFailure('IO', `JaneT could not ${action} this local file.`);
}

function safeReplaceFailureFromError<T>(error: unknown): TextFileResult<T> {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EXDEV' || code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EBUSY') {
    return textFileFailure(
      'SAFE_REPLACE_UNAVAILABLE',
      'This filesystem could not atomically replace the original file, so JaneT left it unchanged.',
    );
  }
  return textFileFailureFromError(error, 'safely replace');
}

function textFileId(stats: fs.BigIntStats): string | undefined {
  if (stats.ino === 0n) return undefined;
  return `${stats.dev.toString(16)}:${stats.ino.toString(16)}`;
}

function stableStatSignature(stats: fs.BigIntStats): string {
  return [
    stats.dev,
    stats.ino,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
    stats.mode,
    stats.nlink,
    stats.uid,
    stats.gid,
  ].join(':');
}

function pathsMatch(left: string, right: string): boolean {
  const normalize = (candidate: string) => (
    process.platform === 'win32' ? path.normalize(candidate).toLocaleLowerCase() : path.normalize(candidate)
  );
  return normalize(left) === normalize(right);
}

export class FileSystemManager {
  private readonly snapshots = new Map<string, DirectorySnapshot>();
  private readonly textFileWriteTails = new Map<string, Promise<void>>();

  constructor(
    private readonly fullStatIntervalMs = DEFAULT_FULL_STAT_INTERVAL_MS,
    private readonly watchDirectory: WatchDirectory = (directory, listener) => (
      fs.watch(directory, { persistent: false }, listener)
    ),
  ) {}

  getHome(): string {
    return os.homedir();
  }

  getDrives(): string[] {
    if (process.platform === 'win32') {
      const drives: string[] = [];
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        try {
          fs.accessSync(`${letter}:\\`);
          drives.push(`${letter}:`);
        } catch {}
      }
      return drives;
    }
    return ['/'];
  }

  async listDir(dirPath: string, showHidden: boolean = false): Promise<FileEntry[]> {
    // Normalize path
    const normalizedPath = path.resolve(dirPath);
    let snapshot: DirectorySnapshot | undefined;

    try {
      const now = Date.now();
      snapshot = this.snapshotFor(normalizedPath, now);
      const entries = await fs.promises.readdir(normalizedPath, { withFileTypes: true });
      const dirtyNames = new Set(snapshot.dirtyNames);
      const refreshAll = snapshot.entries.size === 0 || (snapshot.watcherStarted && snapshot.watcher === null) || snapshot.dirtyAll ||
        now - snapshot.lastFullStatAt >= this.fullStatIntervalMs;

      // Clear only the work observed at the start. New watch events that arrive
      // while stats are in flight remain queued for the next heartbeat.
      for (const name of dirtyNames) snapshot.dirtyNames.delete(name);
      if (snapshot.dirtyAll) snapshot.dirtyAll = false;

      const currentNames = new Set(entries.map((entry) => entry.name));
      const scanSnapshot = snapshot;
      const result = await Promise.all(entries.map(async (entry): Promise<FileEntry> => {
        const previous = scanSnapshot.entries.get(entry.name);
        const typeChanged = previous !== undefined && (
          previous.isSymlink !== entry.isSymbolicLink() ||
          (!entry.isSymbolicLink() && previous.isDirectory !== entry.isDirectory())
        );
        if (!refreshAll && previous && !typeChanged && !dirtyNames.has(entry.name)) {
          return previous;
        }
        return this.readEntryMetadata(normalizedPath, entry, previous);
      }));

      // `cleanup()` can run while metadata reads are in flight. Only mutate the
      // cache or attach a watcher if this is still the owned snapshot.
      if (this.snapshots.get(normalizedPath) === snapshot) {
        for (const name of snapshot.entries.keys()) {
          if (!currentNames.has(name)) snapshot.entries.delete(name);
        }
        for (const entry of result) snapshot.entries.set(entry.name, entry);
        if (refreshAll) snapshot.lastFullStatAt = now;
        snapshot.lastUsedAt = now;
        if (!snapshot.watcherStarted) this.startWatcher(normalizedPath, snapshot);
      }

      const visibleEntries = result.filter((entry) => showHidden || !entry.name.startsWith('.'));

      // Sort: directories first, then alphabetically
      visibleEntries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      return visibleEntries;
    } catch (err) {
      if (snapshot) this.dropSnapshot(normalizedPath, snapshot);
      throw new Error(`Cannot list directory ${normalizedPath}: ${err}`);
    }
  }

  async stat(filePath: string): Promise<FileEntry | null> {
    try {
      const resolvedPath = path.resolve(filePath);
      const stat = await fs.promises.stat(resolvedPath);
      return {
        name: path.basename(resolvedPath),
        path: resolvedPath,
        isDirectory: stat.isDirectory(),
        isSymlink: stat.isSymbolicLink(),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        mode: stat.mode,
      };
    } catch {
      return null;
    }
  }

  async readTextFile(request: unknown): Promise<TextFileResult<TextFileSnapshot>> {
    const validated = validateReadTextFileRequest(request);
    if (!validated.ok) return validated;

    const requestedPath = path.resolve(validated.value.filePath);
    const resolved = await this.resolveTextFilePath(requestedPath);
    if (!resolved.ok) return resolved;

    const opened = await this.readOpenedTextFile(requestedPath, resolved.value);
    if (!opened.ok) return opened;
    return { ok: true, value: opened.value.snapshot };
  }

  async writeTextFile(request: unknown): Promise<TextFileResult<TextFileWriteValue>> {
    const validated = validateWriteTextFileRequest(request);
    if (!validated.ok) return validated;

    const encoded = encodeTextFile(validated.value.content, validated.value.hasUtf8Bom);
    if (!encoded.ok) return encoded;

    const requestedPath = path.normalize(validated.value.requestedPath);
    const suppliedResolvedPath = path.normalize(validated.value.resolvedPath);
    const initiallyResolved = await this.resolveTextFilePath(requestedPath);
    if (!initiallyResolved.ok) return initiallyResolved;
    if (!pathsMatch(initiallyResolved.value, suppliedResolvedPath)) {
      return textFileFailure(
        'CONFLICT',
        'The selected path now resolves to a different file. Reopen it before saving.',
      );
    }

    return this.withSerializedTextFileWrite(initiallyResolved.value, async () => {
      try {
        return await this.writeTextFileSerialized(
          validated.value,
          encoded.value,
          requestedPath,
          initiallyResolved.value,
        );
      } catch (error) {
        return textFileFailureFromError(error, 'save');
      }
    });
  }

  cleanup(): void {
    for (const directory of Array.from(this.snapshots.keys())) this.dropSnapshot(directory);
  }

  private async resolveTextFilePath(resolvedInput: string): Promise<TextFileResult<string>> {
    try {
      return { ok: true, value: await fs.promises.realpath(resolvedInput) };
    } catch (error) {
      return textFileFailureFromError(error, 'open');
    }
  }

  private async readOpenedTextFile(
    requestedPath: string,
    resolvedPath: string,
  ): Promise<TextFileResult<OpenedLocalTextFile>> {
    let handle: FileHandle | undefined;
    try {
      const safeOpenFlags = process.platform === 'win32'
        ? fs.constants.O_RDONLY
        : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
      handle = await fs.promises.open(resolvedPath, safeOpenFlags);
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) {
        return textFileFailure('NOT_FILE', 'The selected path is not a regular file.');
      }

      const buffer = Buffer.allocUnsafe(TEXT_FILE_READ_BUFFER_BYTES);
      let bytesRead = 0;
      while (bytesRead < buffer.byteLength) {
        const chunk = await handle.read(
          buffer,
          bytesRead,
          buffer.byteLength - bytesRead,
          bytesRead,
        );
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }

      const after = await handle.stat({ bigint: true });
      if (!after.isFile()) {
        return textFileFailure('NOT_FILE', 'The selected path is not a regular file.');
      }
      if (bytesRead > MAX_TEXT_FILE_BYTES || after.size > BigInt(MAX_TEXT_FILE_BYTES)) {
        return textFileFailure('TOO_LARGE', 'This file is larger than JaneT\'s 2 MiB editor limit.');
      }
      if (
        stableStatSignature(before) !== stableStatSignature(after)
        || after.size !== BigInt(bytesRead)
      ) {
        return textFileFailure(
          'CONFLICT',
          'The file changed while JaneT was reading it. Try opening it again.',
        );
      }

      const bytes = Buffer.from(buffer.subarray(0, bytesRead));
      const decoded = decodeTextFile(bytes);
      if (!decoded.ok) return decoded;
      const revision = textFileRevision(bytes, {
        size: bytesRead,
        mtime: after.mtime,
        fileId: textFileId(after),
      });
      return {
        ok: true,
        value: {
          snapshot: {
            requestedPath,
            resolvedPath,
            content: decoded.value.content,
            encoding: 'utf8',
            hasUtf8Bom: decoded.value.hasUtf8Bom,
            revision,
          },
          stats: after,
        },
      };
    } catch (error) {
      return textFileFailureFromError(error, 'open');
    } finally {
      if (handle) {
        try { await handle.close(); } catch {}
      }
    }
  }

  private async writeTextFileSerialized(
    request: WriteLocalTextFileRequest,
    bytes: Buffer,
    requestedPath: string,
    expectedResolvedPath: string,
  ): Promise<TextFileResult<TextFileWriteValue>> {
    const currentlyResolved = await this.resolveTextFilePath(requestedPath);
    if (!currentlyResolved.ok) return currentlyResolved;
    if (!pathsMatch(currentlyResolved.value, expectedResolvedPath)) {
      return textFileFailure(
        'CONFLICT',
        'The selected path now resolves to a different file. Reopen it before saving.',
      );
    }

    const current = await this.readOpenedTextFile(requestedPath, currentlyResolved.value);
    if (!current.ok) return current;
    const safeCurrent = this.ensureSafeReplacement(current.value.stats);
    if (!safeCurrent.ok) return safeCurrent;
    if (!request.overwrite && !revisionsMatch(request.expectedRevision, current.value.snapshot.revision)) {
      return textFileFailure(
        'CONFLICT',
        'The file changed outside JaneT. Review the latest version before overwriting it.',
      );
    }

    const mode = Number(current.value.stats.mode & 0o777n);
    let temporary: PreparedTextFile | undefined;
    try {
      temporary = await this.openExclusiveTextFileTemp(currentlyResolved.value, mode);
      const temporaryHandle = temporary.handle!;
      const temporaryInitialStats = await temporaryHandle.stat({ bigint: true });
      if (
        process.platform !== 'win32'
        && (
          temporaryInitialStats.uid !== current.value.stats.uid
          || temporaryInitialStats.gid !== current.value.stats.gid
        )
      ) {
        return textFileFailure(
          'SAFE_REPLACE_UNAVAILABLE',
          'JaneT cannot preserve this file\'s ownership with an atomic replacement, so it was left unchanged.',
        );
      }
      await temporaryHandle.chmod(mode);
      await temporaryHandle.writeFile(bytes);
      await temporaryHandle.sync();
      const temporaryStats = await temporaryHandle.stat({ bigint: true });
      if (!temporaryStats.isFile() || temporaryStats.size !== BigInt(bytes.byteLength)) {
        return textFileFailure(
          'IO',
          'JaneT could not verify the complete temporary file, so the original was left unchanged.',
        );
      }
      const savedRevision = textFileRevision(bytes, {
        size: bytes.byteLength,
        mtime: temporaryStats.mtime,
        fileId: textFileId(temporaryStats),
      });
      await temporaryHandle.close();
      temporary.handle = null;

      // Re-resolve and re-read immediately before replacement. This catches path
      // retargeting and concurrent writes without ever truncating the target.
      const latestResolved = await this.resolveTextFilePath(requestedPath);
      if (!latestResolved.ok) return latestResolved;
      if (!pathsMatch(latestResolved.value, expectedResolvedPath)) {
        return textFileFailure(
          'CONFLICT',
          'The selected path changed while JaneT was preparing the save. The original was left unchanged.',
        );
      }
      const latest = await this.readOpenedTextFile(requestedPath, latestResolved.value);
      if (!latest.ok) return latest;
      const safeLatest = this.ensureSafeReplacement(latest.value.stats);
      if (!safeLatest.ok) return safeLatest;
      if (
        !revisionsMatch(current.value.snapshot.revision, latest.value.snapshot.revision)
        || stableStatSignature(current.value.stats) !== stableStatSignature(latest.value.stats)
      ) {
        return textFileFailure(
          'CONFLICT',
          'The file changed while JaneT was preparing the save. Try saving again after reviewing it.',
        );
      }

      try {
        await fs.promises.rename(temporary.path, expectedResolvedPath);
      } catch (error) {
        return safeReplaceFailureFromError(error);
      }
      temporary = undefined;
      this.markTextFileDirty(requestedPath);
      this.markTextFileDirty(expectedResolvedPath);
      return {
        ok: true,
        value: {
          requestedPath,
          resolvedPath: expectedResolvedPath,
          revision: savedRevision,
        },
      };
    } catch (error) {
      return textFileFailureFromError(error, 'save');
    } finally {
      if (temporary?.handle) {
        try { await temporary.handle.close(); } catch {}
      }
      if (temporary?.path && !pathsMatch(temporary.path, expectedResolvedPath)) {
        try { await fs.promises.unlink(temporary.path); } catch {}
      }
    }
  }

  private ensureSafeReplacement(stats: fs.BigIntStats): TextFileResult<void> {
    if (!stats.isFile()) {
      return textFileFailure('NOT_FILE', 'The selected path is not a regular file.');
    }
    if (stats.nlink !== 1n) {
      return textFileFailure(
        'SAFE_REPLACE_UNAVAILABLE',
        'This file has multiple hard links, so replacing it could change link semantics. It was left unchanged.',
      );
    }
    if ((stats.mode & 0o7000n) !== 0n) {
      return textFileFailure(
        'SAFE_REPLACE_UNAVAILABLE',
        'This file uses special permission bits that JaneT cannot safely preserve during replacement.',
      );
    }
    return { ok: true, value: undefined };
  }

  private async openExclusiveTextFileTemp(targetPath: string, mode: number): Promise<PreparedTextFile> {
    const directory = path.dirname(targetPath);
    for (let attempt = 0; attempt < TEXT_FILE_TEMP_ATTEMPTS; attempt += 1) {
      const candidate = path.join(
        directory,
        `.janet-save-${process.pid}-${randomBytes(12).toString('hex')}.tmp`,
      );
      if (pathsMatch(candidate, targetPath)) continue;
      try {
        const handle = await fs.promises.open(
          candidate,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
          mode,
        );
        return { handle, path: candidate };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
    }
    const error = new Error('Could not allocate an exclusive temporary file') as NodeJS.ErrnoException;
    error.code = 'EEXIST';
    throw error;
  }

  private async withSerializedTextFileWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.textFileWriteTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.textFileWriteTails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.textFileWriteTails.get(key) === tail) this.textFileWriteTails.delete(key);
    }
  }

  private markTextFileDirty(filePath: string): void {
    const directory = path.dirname(filePath);
    const snapshot = this.snapshots.get(directory);
    if (snapshot) snapshot.dirtyNames.add(path.basename(filePath));
  }

  private snapshotFor(directory: string, now: number): DirectorySnapshot {
    const existing = this.snapshots.get(directory);
    if (existing) {
      existing.lastUsedAt = now;
      return existing;
    }

    if (this.snapshots.size >= MAX_DIRECTORY_SNAPSHOTS) {
      const oldest = Array.from(this.snapshots.entries()).sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
      if (oldest) this.dropSnapshot(oldest[0]);
    }

    const snapshot: DirectorySnapshot = {
      entries: new Map(),
      dirtyNames: new Set(),
      dirtyAll: false,
      watcher: null,
      watcherStarted: false,
      lastFullStatAt: 0,
      lastUsedAt: now,
    };
    this.snapshots.set(directory, snapshot);
    return snapshot;
  }

  private startWatcher(directory: string, snapshot: DirectorySnapshot): void {
    snapshot.watcherStarted = true;
    try {
      const watcher = this.watchDirectory(directory, (_eventType, filename) => {
        if (this.snapshots.get(directory) !== snapshot) return;
        if (filename) snapshot.dirtyNames.add(filename.toString());
        else snapshot.dirtyAll = true;
      });
      watcher.on('error', () => {
        if (this.snapshots.get(directory) !== snapshot || snapshot.watcher !== watcher) return;
        try { watcher.close(); } catch {}
        snapshot.watcher = null;
        snapshot.dirtyAll = true;
      });
      snapshot.watcher = watcher;
    } catch {
      // Some network/virtual filesystems cannot be watched. In that case each
      // heartbeat performs a full metadata pass to preserve correctness.
      snapshot.watcher = null;
    }
  }

  private async readEntryMetadata(
    directory: string,
    entry: fs.Dirent,
    previous?: FileEntry,
  ): Promise<FileEntry> {
    const fullPath = path.join(directory, entry.name);
    try {
      const metadata = await fs.promises.stat(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isSymbolicLink() ? metadata.isDirectory() : entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
        size: metadata.size,
        mtime: metadata.mtime.toISOString(),
        mode: metadata.mode,
      };
    } catch {
      return previous ?? {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
        size: 0,
        mtime: '',
        mode: 0,
      };
    }
  }

  private dropSnapshot(directory: string, expected?: DirectorySnapshot): void {
    const snapshot = this.snapshots.get(directory);
    if (!snapshot || (expected && snapshot !== expected)) return;
    try { snapshot.watcher?.close(); } catch {}
    this.snapshots.delete(directory);
  }
}
