import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: string;
  mode: number;
}

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

export class FileSystemManager {
  private readonly snapshots = new Map<string, DirectorySnapshot>();

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

  cleanup(): void {
    for (const directory of Array.from(this.snapshots.keys())) this.dropSnapshot(directory);
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
