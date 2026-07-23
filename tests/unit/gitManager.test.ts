import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
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

describe('GitManager working tree actions', () => {
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
