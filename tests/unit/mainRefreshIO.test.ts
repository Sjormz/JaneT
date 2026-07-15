import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectoryWatchListener, FileSystemManager } from '../../src/main/filesystem';
import { GitManager } from '../../src/main/git';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'janet-refresh-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe('heartbeat-backed main-process IO', () => {
  it('lists and sorts directories asynchronously while respecting hidden-file visibility', async () => {
    const root = await makeTempDir();
    await Promise.all([
      fs.promises.mkdir(path.join(root, 'beta')),
      fs.promises.mkdir(path.join(root, 'alpha')),
      fs.promises.writeFile(path.join(root, 'zeta.txt'), 'data'),
      fs.promises.writeFile(path.join(root, '.hidden'), 'secret'),
    ]);

    const manager = new FileSystemManager();
    const visible = await manager.listDir(root);
    expect(visible.map((entry) => entry.name)).toEqual(['alpha', 'beta', 'zeta.txt']);
    await expect(manager.stat(path.join(root, 'zeta.txt'))).resolves.toEqual(
      expect.objectContaining({ name: 'zeta.txt', size: 4, isDirectory: false }),
    );

    const withHidden = await manager.listDir(root, true);
    expect(withHidden.map((entry) => entry.name)).toContain('.hidden');
    manager.cleanup();
  });

  it('reuses cached metadata and refreshes only an entry dirtied by the directory watcher', async () => {
    const root = await makeTempDir();
    const firstPath = path.join(root, 'first.txt');
    const secondPath = path.join(root, 'second.txt');
    await Promise.all([
      fs.promises.writeFile(firstPath, 'one'),
      fs.promises.writeFile(secondPath, 'two'),
    ]);

    let notifyChange: DirectoryWatchListener | undefined;
    const manager = new FileSystemManager(60_000, (_directory, listener) => {
      notifyChange = listener;
      return {
        on() { return this; },
        close() {},
      };
    });
    const statSpy = vi.spyOn(fs.promises, 'stat');
    await manager.listDir(root);
    statSpy.mockClear();

    const unchanged = await manager.listDir(root);
    expect(statSpy).not.toHaveBeenCalled();
    expect(unchanged.find((entry) => entry.name === 'first.txt')?.size).toBe(3);

    await fs.promises.writeFile(firstPath, 'changed contents');
    notifyChange?.('change', 'first.txt');
    const refreshed = await manager.listDir(root);

    expect(refreshed.find((entry) => entry.name === 'first.txt')?.size).toBe(16);
    expect(refreshed.find((entry) => entry.name === 'second.txt')?.size).toBe(3);
    expect(statSpy.mock.calls.some((call) => call[0] === firstPath)).toBe(true);
    expect(statSpy.mock.calls.some((call) => call[0] === secondPath)).toBe(false);
    statSpy.mockRestore();
    manager.cleanup();
  });

  it('does not attach a watcher after cleanup wins a race with the initial metadata scan', async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, 'pending.txt');
    await fs.promises.writeFile(filePath, 'pending');

    const realStat = fs.promises.stat.bind(fs.promises);
    let releaseStat!: () => void;
    const statGate = new Promise<void>((resolve) => { releaseStat = resolve; });
    let statStarted!: () => void;
    const started = new Promise<void>((resolve) => { statStarted = resolve; });
    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (...args) => {
      statStarted();
      await statGate;
      return realStat(...args);
    });
    const watchDirectory = vi.fn(() => ({
      on() { return this; },
      close() {},
    }));
    const manager = new FileSystemManager(60_000, watchDirectory);

    const pendingList = manager.listDir(root);
    await started;
    manager.cleanup();
    releaseStat();
    await expect(pendingList).resolves.toEqual([
      expect.objectContaining({ name: 'pending.txt', size: 7 }),
    ]);

    expect(watchDirectory).not.toHaveBeenCalled();
    statSpy.mockRestore();
  });

  it('does not resurrect a directory snapshot when cleanup runs during readdir', async () => {
    const root = await makeTempDir();
    await fs.promises.writeFile(path.join(root, 'pending.txt'), 'pending');

    const realReaddir = fs.promises.readdir.bind(fs.promises) as (...args: any[]) => Promise<any>;
    let releaseReaddir!: () => void;
    const readdirGate = new Promise<void>((resolve) => { releaseReaddir = resolve; });
    let readdirStarted!: () => void;
    const started = new Promise<void>((resolve) => { readdirStarted = resolve; });
    const readdirSpy = vi.spyOn(fs.promises, 'readdir').mockImplementation((async (...args: any[]) => {
      readdirStarted();
      await readdirGate;
      return realReaddir(...args);
    }) as any);
    const watchDirectory = vi.fn(() => ({
      on() { return this; },
      close() {},
    }));
    const manager = new FileSystemManager(60_000, watchDirectory);

    const pendingList = manager.listDir(root);
    await started;
    manager.cleanup();
    releaseReaddir();
    await expect(pendingList).resolves.toEqual([
      expect.objectContaining({ name: 'pending.txt', size: 7 }),
    ]);

    expect(watchDirectory).not.toHaveBeenCalled();
    readdirSpy.mockRestore();
  });

  it('discovers a repository from a nested directory when .git is a worktree file', async () => {
    const root = await makeTempDir();
    const nested = path.join(root, 'src', 'feature');
    await fs.promises.mkdir(nested, { recursive: true });
    await fs.promises.writeFile(path.join(root, '.git'), 'gitdir: ../metadata');

    await expect(new GitManager().findRepo(nested)).resolves.toBe(root);
  });
});
