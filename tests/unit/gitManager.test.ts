import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAddWorktreeArgs, GitManager, normalizeGitStatus } from '../../src/main/git';

const temporaryDirectories: string[] = [];

function temporaryDirectory(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), name));
  temporaryDirectories.push(directory);
  return directory;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function initializeRepository(): string {
  const repository = temporaryDirectory('janet-git-manager-');
  git(repository, 'init', '-b', 'main');
  git(repository, 'config', 'user.name', 'JaneT Test');
  git(repository, 'config', 'user.email', 'janet@example.invalid');
  fs.writeFileSync(path.join(repository, 'base.txt'), 'base\n');
  git(repository, 'add', 'base.txt');
  git(repository, 'commit', '-m', 'base');
  return repository;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('normalizeGitStatus', () => {
  it('derives staged state from the index and keeps conflicts distinct', () => {
    const result = normalizeGitStatus({
      current: 'main',
      tracking: null,
      files: [
        { path: 'staged.ts', index: 'M', working_dir: ' ' },
        { path: 'working.ts', index: ' ', working_dir: 'M' },
        { path: 'mixed.ts', index: 'M', working_dir: 'M' },
        { path: 'conflict.ts', index: 'U', working_dir: 'U' },
      ],
      staged: ['staged.ts', 'mixed.ts'],
      conflicted: ['conflict.ts'],
      created: [],
      deleted: [],
      modified: ['staged.ts', 'working.ts', 'mixed.ts'],
      renamed: [],
      ahead: 0,
      behind: 0,
    });

    expect(result.files).toEqual([
      { path: 'staged.ts', index: 'M', working_dir: ' ', staged: true, unstaged: false },
      { path: 'working.ts', index: ' ', working_dir: 'M', staged: false, unstaged: true },
      { path: 'mixed.ts', index: 'M', working_dir: 'M', staged: true, unstaged: true },
      { path: 'conflict.ts', index: 'U', working_dir: 'U', staged: false, unstaged: false },
    ]);
    expect(result.conflicted).toEqual(['conflict.ts']);
  });

  it('preserves the original path reported for a rename', () => {
    expect(normalizeGitStatus({
      files: [{ path: 'new-name.ts', from: 'old-name.ts', index: 'R', working_dir: ' ' }],
    }).files).toEqual([
      {
        path: 'new-name.ts',
        originalPath: 'old-name.ts',
        index: 'R',
        working_dir: ' ',
        staged: true,
        unstaged: false,
      },
    ]);
  });
});

describe('buildAddWorktreeArgs', () => {
  it('lets Git use HEAD when creating a branch without an explicit start point', () => {
    expect(buildAddWorktreeArgs('/tmp/repo-feature', 'feature/new', true)).toEqual([
      'worktree', 'add', '-b', 'feature/new', '/tmp/repo-feature',
    ]);
  });

  it('preserves explicit and existing-branch start points', () => {
    expect(buildAddWorktreeArgs('/tmp/repo-feature', 'feature/new', true, 'origin/main')).toEqual([
      'worktree', 'add', '-b', 'feature/new', '/tmp/repo-feature', 'origin/main',
    ]);
    expect(buildAddWorktreeArgs('/tmp/repo-existing', 'feature/existing', false)).toEqual([
      'worktree', 'add', '/tmp/repo-existing', 'feature/existing',
    ]);
  });
});

describe('GitManager working tree actions', { timeout: 30_000 }, () => {
  it('returns bounded staged and working-tree text snapshots for diff previews', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const tracked = path.join(repository, 'base.txt');
    fs.writeFileSync(tracked, 'staged\n');
    git(repository, 'add', 'base.txt');
    fs.writeFileSync(tracked, 'working\n');

    await expect((manager as any).diff(repository, 'base.txt', 'staged')).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        side: 'staged', originalContent: 'base\n', modifiedContent: 'staged\n',
      }),
    });
    await expect((manager as any).diff(repository, 'base.txt', 'unstaged')).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        side: 'unstaged', originalContent: 'staged\n', modifiedContent: 'working\n',
      }),
    });
  });

  it('reads the original Git path for a staged rename preview', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    git(repository, 'mv', 'base.txt', 'renamed.txt');
    fs.writeFileSync(path.join(repository, 'renamed.txt'), 'renamed\n');
    git(repository, 'add', 'renamed.txt');

    await expect((manager.diff as any)(repository, 'renamed.txt', 'staged', 'base.txt')).resolves.toMatchObject({
      ok: true,
      value: {
        filePath: 'renamed.txt',
        originalPath: 'base.txt',
        originalContent: 'base\n',
        modifiedContent: 'renamed\n',
      },
    });
    await expect((manager.diff as any)(repository, 'renamed.txt', 'staged', '../base.txt')).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('uses empty snapshots for added or deleted sides and rejects unsafe preview content', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    fs.writeFileSync(path.join(repository, 'added.txt'), 'added\n');
    git(repository, 'add', 'added.txt');
    git(repository, 'rm', 'base.txt');

    await expect((manager as any).diff(repository, 'added.txt', 'staged')).resolves.toMatchObject({
      ok: true, value: { originalContent: '', modifiedContent: 'added\n' },
    });
    await expect((manager as any).diff(repository, 'base.txt', 'staged')).resolves.toMatchObject({
      ok: true, value: { originalContent: 'base\n', modifiedContent: '' },
    });
    await expect((manager as any).diff(repository, '../outside.txt', 'unstaged')).resolves.toMatchObject({
      ok: false, error: { code: 'INVALID_REQUEST' },
    });

    fs.writeFileSync(path.join(repository, 'binary.bin'), Buffer.from([0, 1, 2]));
    await expect((manager as any).diff(repository, 'binary.bin', 'unstaged')).resolves.toMatchObject({
      ok: false, error: { code: 'BINARY' },
    });
    fs.writeFileSync(path.join(repository, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
    await expect((manager as any).diff(repository, 'large.txt', 'unstaged')).resolves.toMatchObject({
      ok: false, error: { code: 'TOO_LARGE' },
    });
    await expect(manager.diff(path.join(repository, 'missing'), 'base.txt', 'staged')).resolves.toMatchObject({
      ok: false, error: { code: 'IO' },
    });
  });

  it('keeps a working-tree preview bound to the checked in-repository file', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const tracked = path.join(repository, 'base.txt');
    const outside = path.join(temporaryDirectory('janet-git-outside-'), 'secret.txt');
    fs.writeFileSync(tracked, 'working\n');
    fs.writeFileSync(outside, 'outside secret\n');
    const readFile = fs.promises.readFile;
    const pathnameRead = vi.spyOn(fs.promises, 'readFile').mockImplementation((async (
      target: any,
      options?: any,
    ) => readFile.call(
      fs.promises,
      path.resolve(String(target)) === path.resolve(tracked) ? outside : target,
      options,
    )) as any);

    try {
      await expect(manager.diff(repository, 'base.txt', 'unstaged')).resolves.toMatchObject({
        ok: true,
        value: { modifiedContent: 'working\n' },
      });
    } finally {
      pathnameRead.mockRestore();
    }
  });

  it('rejects a working-tree path redirected after repository containment is checked', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const tracked = path.join(repository, 'base.txt');
    const outside = path.join(temporaryDirectory('janet-git-outside-'), 'secret.txt');
    fs.writeFileSync(tracked, 'working\n');
    fs.writeFileSync(outside, 'outside secret\n');
    const open = fs.promises.open;
    const lstat = fs.promises.lstat;
    const realpath = fs.promises.realpath;
    let redirected = false;
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation((async (target: any, flags: any) => {
      if (path.resolve(String(target)) === path.resolve(tracked)) redirected = true;
      return open.call(fs.promises, redirected ? outside : target, flags);
    }) as any);
    const lstatSpy = vi.spyOn(fs.promises, 'lstat').mockImplementation((async (target: any, options?: any) => (
      lstat.call(fs.promises, redirected ? outside : target, options)
    )) as any);
    const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation((async (target: any, options?: any) => (
      realpath.call(fs.promises, redirected && path.resolve(String(target)) === path.resolve(tracked) ? outside : target, options)
    )) as any);

    try {
      await expect(manager.diff(repository, 'base.txt', 'unstaged')).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
    } finally {
      openSpy.mockRestore();
      lstatSpy.mockRestore();
      realpathSpy.mockRestore();
    }
  });

  it('rejects invalid and unbounded Git history limits while accepting the exact ceiling', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();

    for (const limit of [0, -1, 1.5, Number.NaN, 1_001]) {
      await expect(manager.log(repository, limit)).resolves.toBeNull();
    }
    await expect(manager.log(repository, 1_000)).resolves.toHaveLength(1);
  });

  it('rejects malformed commit messages at the IPC-facing boundary', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();

    expect(await manager.commit(repository, null as unknown as string)).toBe(false);
  });

  it('stages, unstages, and commits selected changes', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    fs.writeFileSync(path.join(repository, 'working.txt'), 'working\n');

    expect(await manager.stage(repository, ['working.txt'])).toBe(true);
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('working.txt');

    expect(await manager.unstage(repository, ['working.txt'])).toBe(true);
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('');

    expect(await manager.stage(repository, [])).toBe(true);
    expect(await manager.unstage(repository, [])).toBe(true);
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('');
    expect(await manager.stage(repository, [])).toBe(true);
    expect(await manager.commit(repository, 'add working file')).toBe(true);
    expect(git(repository, 'log', '-1', '--pretty=%s')).toBe('add working file');
    expect(git(repository, 'status', '--porcelain')).toBe('');
  });

  it('discards tracked working-tree changes while preserving staged and untracked content', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const tracked = path.join(repository, 'base.txt');
    const second = path.join(repository, 'second.txt');
    const untracked = path.join(repository, 'untracked.txt');

    fs.writeFileSync(second, 'second\n');
    expect(await manager.stage(repository, ['second.txt'])).toBe(true);
    expect(await manager.commit(repository, 'add second file')).toBe(true);
    fs.writeFileSync(tracked, 'staged\n');
    expect(await manager.stage(repository, ['base.txt'])).toBe(true);
    fs.writeFileSync(tracked, 'unstaged\n');
    fs.writeFileSync(second, 'second unstaged\n');
    fs.writeFileSync(untracked, 'keep me\n');

    expect(await manager.discard(repository, ['base.txt'])).toBe(true);
    expect(fs.readFileSync(tracked, 'utf8').trim()).toBe('staged');
    expect(git(repository, 'diff', '--name-only')).toBe('second.txt');
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('base.txt');

    fs.writeFileSync(tracked, 'unstaged again\n');
    expect(await manager.discard(repository, ['base.txt', 'second.txt'])).toBe(true);
    expect(fs.readFileSync(tracked, 'utf8').trim()).toBe('staged');
    expect(fs.readFileSync(second, 'utf8').trim()).toBe('second');
    expect(fs.readFileSync(untracked, 'utf8').trim()).toBe('keep me');
    expect(await manager.discard(repository, [])).toBe(false);
    expect(await manager.discard(repository, null as unknown as string[])).toBe(false);
  });

  it('treats unusual filenames as literal Git paths', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const filenames = ['-leading-dash.txt', 'magic[1].txt', 'with space.txt'];
    for (const filename of filenames) fs.writeFileSync(path.join(repository, filename), `${filename}\n`);

    expect(await manager.stage(repository, filenames)).toBe(true);
    expect(git(repository, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean).sort()).toEqual([...filenames].sort());
    expect(await manager.unstage(repository, filenames)).toBe(true);
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('');
    expect(await manager.stage(repository, null as unknown as string[])).toBe(false);
  });

  it('fetches, pulls, and pushes against the tracked remote', async () => {
    const root = temporaryDirectory('janet-git-remote-');
    const remote = path.join(root, 'origin.git');
    const upstream = path.join(root, 'upstream');
    const checkout = path.join(root, 'checkout');
    fs.mkdirSync(upstream);
    git(root, 'init', '--bare', remote);
    git(upstream, 'init', '-b', 'main');
    git(upstream, 'config', 'user.name', 'JaneT Test');
    git(upstream, 'config', 'user.email', 'janet@example.invalid');
    fs.writeFileSync(path.join(upstream, 'base.txt'), 'base\n');
    git(upstream, 'add', 'base.txt');
    git(upstream, 'commit', '-m', 'base');
    git(upstream, 'remote', 'add', 'origin', remote);
    git(upstream, 'push', '-u', 'origin', 'main');
    git(root, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(root, 'clone', remote, checkout);
    git(checkout, 'config', 'user.name', 'JaneT Test');
    git(checkout, 'config', 'user.email', 'janet@example.invalid');

    fs.writeFileSync(path.join(upstream, 'upstream.txt'), 'upstream\n');
    git(upstream, 'add', 'upstream.txt');
    git(upstream, 'commit', '-m', 'upstream change');
    git(upstream, 'push');

    const manager = new GitManager();
    expect(await manager.fetch(checkout)).toBe(true);
    expect(git(checkout, 'log', '-1', '--pretty=%s', 'origin/main')).toBe('upstream change');
    expect(await manager.pull(checkout)).toBe(true);
    expect(fs.readFileSync(path.join(checkout, 'upstream.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('upstream\n');

    fs.writeFileSync(path.join(checkout, 'local.txt'), 'local\n');
    expect(await manager.stage(checkout, ['local.txt'])).toBe(true);
    expect(await manager.commit(checkout, 'local change')).toBe(true);
    expect(await manager.push(checkout)).toBe(true);
    expect(git(root, '--git-dir', remote, 'log', '-1', '--pretty=%s', 'main')).toBe('local change');
  });
});
