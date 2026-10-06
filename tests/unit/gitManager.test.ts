import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  branchNameError,
  buildAddWorktreeArgs,
  describeGitFailure,
  GitManager,
  normalizeGitStatus,
  parseGitStatusPorcelain,
  revisionError,
  sanitizeGitMessage,
} from '../../src/main/git';
import { MAX_GIT_ERROR_LENGTH } from '../../src/shared/gitResults';

const temporaryDirectories: string[] = [];

function temporaryDirectory(name: string): string {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), name));
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

  it('parses machine status without treating conflicts as ordinary changes', () => {
    const result = parseGitStatusPorcelain([
      '## main...origin/main [gone]',
      'AU conflict.txt',
      'R  new name.txt',
      'old name.txt',
      '',
    ].join('\0'));

    expect(result).toMatchObject({
      current: 'main',
      tracking: 'origin/main',
      ahead: 0,
      behind: 0,
      created: [],
      conflicted: ['conflict.txt'],
    });
    expect(result.files).toEqual([
      { path: 'conflict.txt', index: 'A', working_dir: 'U', staged: false, unstaged: false },
      {
        path: 'new name.txt',
        originalPath: 'old name.txt',
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
      'worktree', 'add', '-b', 'feature/new', '--end-of-options', '/tmp/repo-feature',
    ]);
  });

  it('preserves explicit and existing-branch start points after the end of options', () => {
    expect(buildAddWorktreeArgs('/tmp/repo-feature', 'feature/new', true, 'origin/main')).toEqual([
      'worktree', 'add', '-b', 'feature/new', '--end-of-options', '/tmp/repo-feature', 'origin/main',
    ]);
    expect(buildAddWorktreeArgs('/tmp/repo-existing', 'feature/existing', false)).toEqual([
      'worktree', 'add', '--end-of-options', '/tmp/repo-existing', 'feature/existing',
    ]);
  });
});

describe('Git argument validation', () => {
  it('accepts ordinary branch names and rejects Git-invalid or option-shaped ones', () => {
    for (const name of ['main', 'feature/new-thing', 'release-1.2', 'user@work', 'fix_123']) {
      expect(branchNameError(name), name).toBeNull();
    }
    for (const name of [
      '', '   ', '-f', '--force', '--upload-pack=evil', 'HEAD', '@', 'has space', 'a..b', 'a@{1}', 'a//b',
      '/lead', 'trail/', 'dot.', '.hidden', 'feature/.hidden', 'x.lock', 'feature/x.lock', 'tilde~1',
      'caret^', 'colon:x', 'q?', 'star*', 'br[ack', 'back\\slash', 'nul\0x', 'tab\tx', 'x'.repeat(256),
      null, 42, { name: 'main' },
    ]) {
      expect(branchNameError(name), JSON.stringify(name)).toEqual(expect.any(String));
    }
  });

  it('accepts optional revisions and rejects option-shaped start points', () => {
    for (const revision of [undefined, '', 'origin/main', 'HEAD~2', 'v1.0^{}', 'abc1234']) {
      expect(revisionError(revision), String(revision)).toBeNull();
    }
    for (const revision of ['-b', '--output=/tmp/x', 'bad\nline', 7, 'x'.repeat(1_025)]) {
      expect(revisionError(revision), String(revision)).toEqual(expect.any(String));
    }
  });

  it('redacts credentials, strips terminal escapes, prefers error lines, and bounds the message', () => {
    const message = sanitizeGitMessage([
      'hint: see git help',
      "fatal: unable to access 'https://alice:s3cret-pass@example.com/repo.git/': The requested URL returned error: 403",
      'error: token ghp_abcdefghijklmnopqrstuvwxyz0123456789 rejected \u001b[31mred\u001b[0m',
      'Authorization: Bearer abc.def.ghi-123',
      'url https://example.com/x?access_token=abcd1234&x=1',
    ].join('\n'));
    expect(message).not.toContain('s3cret');
    expect(message).not.toContain('alice');
    expect(message).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(message).not.toContain('abc.def.ghi-123');
    expect(message).not.toContain('abcd1234');
    expect(message).not.toContain('\u001b');
    expect(message).not.toContain('hint:');
    expect(message).toContain('https://***@example.com/repo.git/');
    expect(message).toContain('returned error: 403');
    expect(message).not.toContain('\n');

    const long = sanitizeGitMessage(`fatal: ${'x'.repeat(5_000)}`);
    expect(long.length).toBeLessThanOrEqual(MAX_GIT_ERROR_LENGTH);
    expect(long.endsWith('…')).toBe(true);
    expect(sanitizeGitMessage('hint: only a hint')).toBe('hint: only a hint');
  });

  it('explains timeouts and a missing Git executable without raw process details', () => {
    expect(describeGitFailure({ message: 'block timeout reached', plugin: 'timeout' }, 20_000))
      .toMatch(/did not respond for 20 seconds/);
    expect(describeGitFailure(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }), 20_000))
      .toBe('Git is not installed or is not on PATH.');
    expect(describeGitFailure(new Error(''), 20_000)).toBe('Git failed without an error message.');
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

  it('previews repository filenames that begin with two dots', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    fs.writeFileSync(path.join(repository, '..config'), 'valid\n');

    await expect(manager.diff(repository, '..config', 'unstaged')).resolves.toMatchObject({
      ok: true,
      value: { originalContent: '', modifiedContent: 'valid\n' },
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
    // This fixture has one base.txt. Match its basename so Windows namespace
    // and short-path spellings cannot silently bypass the injected redirection.
    const isTracked = (target: unknown) => path.basename(String(target)) === 'base.txt';
    const open = fs.promises.open;
    const realpath = fs.promises.realpath;
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation((async (target: any, flags: any) => {
      return open.call(
        fs.promises,
        isTracked(target) ? outside : target,
        flags,
      );
    }) as any);
    let trackedRealpaths = 0;
    const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation((async (target: any, options?: any) => (
      realpath.call(
        fs.promises,
        isTracked(target) && trackedRealpaths++ > 0 ? outside : target,
        options,
      )
    )) as any);

    try {
      const result = await manager.diff(repository, 'base.txt', 'unstaged');
      expect(trackedRealpaths, JSON.stringify(realpathSpy.mock.calls)).toBeGreaterThanOrEqual(2);
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'INVALID_REQUEST' },
      });
    } finally {
      openSpy.mockRestore();
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

    expect(await manager.commit(repository, null as unknown as string)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('stages, unstages, and commits selected changes', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    fs.writeFileSync(path.join(repository, 'working.txt'), 'working\n');

    expect(await manager.stage(repository, ['working.txt'])).toEqual({ ok: true });
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('working.txt');

    expect(await manager.unstage(repository, ['working.txt'])).toEqual({ ok: true });
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('');

    expect(await manager.stage(repository, [])).toEqual({ ok: true });
    expect(await manager.unstage(repository, [])).toEqual({ ok: true });
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('');
    expect(await manager.stage(repository, [])).toEqual({ ok: true });
    expect(await manager.commit(repository, 'add working file')).toEqual({ ok: true });
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
    expect(await manager.stage(repository, ['second.txt'])).toEqual({ ok: true });
    expect(await manager.commit(repository, 'add second file')).toEqual({ ok: true });
    fs.writeFileSync(tracked, 'staged\n');
    expect(await manager.stage(repository, ['base.txt'])).toEqual({ ok: true });
    fs.writeFileSync(tracked, 'unstaged\n');
    fs.writeFileSync(second, 'second unstaged\n');
    fs.writeFileSync(untracked, 'keep me\n');

    expect(await manager.discard(repository, ['base.txt'])).toEqual({ ok: true });
    expect(fs.readFileSync(tracked, 'utf8').trim()).toBe('staged');
    expect(git(repository, 'diff', '--name-only')).toBe('second.txt');
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('base.txt');

    fs.writeFileSync(tracked, 'unstaged again\n');
    expect(await manager.discard(repository, ['base.txt', 'second.txt'])).toEqual({ ok: true });
    expect(fs.readFileSync(tracked, 'utf8').trim()).toBe('staged');
    expect(fs.readFileSync(second, 'utf8').trim()).toBe('second');
    expect(fs.readFileSync(untracked, 'utf8').trim()).toBe('keep me');
    expect(await manager.discard(repository, [])).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await manager.discard(repository, null as unknown as string[])).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('deletes only the selected untracked file or directory', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const selected = path.join(repository, '.hermes', 'plan.md');
    const sibling = path.join(repository, 'keep.txt');
    const outside = path.join(temporaryDirectory('janet-git-outside-'), 'outside.txt');
    fs.mkdirSync(path.dirname(selected));
    fs.writeFileSync(selected, 'delete me\n');
    fs.writeFileSync(sibling, 'keep me\n');
    fs.writeFileSync(outside, 'outside\n');

    expect(await manager.deleteUntracked(repository, '.hermes/plan.md')).toEqual({ ok: true });
    expect(fs.existsSync(selected)).toBe(false);
    expect(fs.readFileSync(sibling, 'utf8')).toBe('keep me\n');
    const directory = path.join(repository, 'untracked-directory');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'nested.txt'), 'delete me too\n');
    expect(await manager.deleteUntracked(repository, 'untracked-directory')).toEqual({ ok: true });
    expect(fs.existsSync(directory)).toBe(false);
    expect(await manager.deleteUntracked(repository, 'base.txt')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(fs.readFileSync(path.join(repository, 'base.txt'), 'utf8')).toBe('base\n');
    expect(await manager.deleteUntracked(repository, '../outside.txt')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n');
  });

  it('treats unusual filenames as literal Git paths', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const filenames = ['-leading-dash.txt', 'magic[1].txt', 'with space.txt'];
    for (const filename of filenames) fs.writeFileSync(path.join(repository, filename), `${filename}\n`);

    expect(await manager.stage(repository, filenames)).toEqual({ ok: true });
    expect(git(repository, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean).sort()).toEqual([...filenames].sort());
    expect(await manager.unstage(repository, filenames)).toEqual({ ok: true });
    expect(git(repository, 'diff', '--cached', '--name-only')).toBe('');
    expect(await manager.stage(repository, null as unknown as string[])).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('preserves leading and trailing spaces in status paths and actions', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const filenames = [' leading-space.txt', 'trailing-space.txt '];
    for (const filename of filenames) fs.writeFileSync(path.join(repository, filename), `${filename}\n`);

    const status = await manager.status(repository);
    expect(status.ok && status.value.files.map((file) => file.path).sort()).toEqual([...filenames].sort());
    const actionable = process.platform === 'win32' ? filenames.slice(0, 1) : filenames;
    expect(await manager.stage(repository, actionable)).toEqual({ ok: true });
    const staged = execFileSync(
      'git', ['diff', '--cached', '--name-only', '-z'], { cwd: repository, encoding: 'utf8' },
    );
    expect(staged.split('\0').filter(Boolean).sort())
      .toEqual([...actionable].sort());
  });

  it('filters inherited Git overrides while preserving ordinary hook environment', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const hook = path.join(repository, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, [
      '#!/bin/sh',
      'printf "%s\\n" "${GIT_CONFIG_COUNT-unset}" "${GIT_AUTHOR_NAME-unset}" "${VISUAL-unset}" "${GIT_SSH_COMMAND-unset}" "$JANET_GIT_TEST_MARKER" > guard-env.txt',
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(repository, 'working.txt'), 'working\n');

    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'user.name');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'Inherited identity');
    vi.stubEnv('GIT_AUTHOR_NAME', 'Inherited author');
    vi.stubEnv('VISUAL', 'inherited-editor');
    vi.stubEnv('GIT_SSH_COMMAND', 'inherited-ssh');
    vi.stubEnv('JANET_GIT_TEST_MARKER', 'ordinary-environment');
    try {
      expect(await manager.stage(repository, ['working.txt'])).toEqual({ ok: true });
      expect(await manager.commit(repository, 'guarded environment')).toEqual({ ok: true });
      // Git supplies the repository's resolved author identity to its hook.
      expect(fs.readFileSync(path.join(repository, 'guard-env.txt'), 'utf8').replace(/\r\n/g, '\n'))
        .toBe('unset\nJaneT Test\nunset\nunset\nordinary-environment\n');
      await expect(manager.log(repository, 1)).resolves.toMatchObject([
        { message: 'guarded environment', author_name: 'JaneT Test', author_email: 'janet@example.invalid' },
      ]);
      const details = await manager.details(repository);
      expect(details).toMatchObject({
        branches: [{ name: 'main', current: true, isRemote: false }],
        worktrees: [{ branch: 'main' }],
      });
      // Native realpath also expands Windows 8.3 aliases used by the temp directory.
      expect(details?.worktrees.map((tree) => fs.realpathSync.native(tree.path))).toEqual([fs.realpathSync.native(repository)]);
      await expect(manager.status(repository)).resolves.toMatchObject({
        ok: true, value: { current: 'main', files: [{ path: 'guard-env.txt', staged: false }] },
      });
    } finally {
      vi.unstubAllEnvs();
    }
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
    expect(await manager.fetch(checkout)).toEqual({ ok: true });
    expect(git(checkout, 'log', '-1', '--pretty=%s', 'origin/main')).toBe('upstream change');
    expect(await manager.pull(checkout)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(checkout, 'upstream.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('upstream\n');

    fs.writeFileSync(path.join(checkout, 'local.txt'), 'local\n');
    expect(await manager.stage(checkout, ['local.txt'])).toEqual({ ok: true });
    expect(await manager.commit(checkout, 'local change')).toEqual({ ok: true });
    expect(await manager.push(checkout)).toEqual({ ok: true });
    expect(git(root, '--git-dir', remote, 'log', '-1', '--pretty=%s', 'main')).toBe('local change');
  });
});

describe('GitManager structured failures and argument safety', { timeout: 30_000 }, () => {
  it('reports why a status read failed instead of an empty result', async () => {
    const manager = new GitManager();
    const notRepository = temporaryDirectory('janet-git-not-repo-');

    const failed = await manager.status(notRepository);
    expect(failed).toMatchObject({ ok: false });
    expect(!failed.ok && failed.error).toMatch(/not a git repository/i);
    await expect(manager.status('relative/repo')).resolves.toEqual({
      ok: false, error: 'The repository path must be an absolute folder path.',
    });
    await expect(manager.status(path.join(notRepository, 'missing'))).resolves.toMatchObject({ ok: false });

    const repository = initializeRepository();
    await expect(manager.status(repository)).resolves.toMatchObject({ ok: true, value: { current: 'main', files: [] } });
  });

  it('returns Git\'s own reason for a failed mutation', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();

    const result = await manager.deleteBranch(repository, 'does-not-exist');
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/does-not-exist/);
    expect(!result.ok && result.error).not.toContain('\n');

    const commit = await manager.commit(repository, 'nothing staged');
    expect(commit).toMatchObject({ ok: false, error: expect.any(String) });
    expect(!commit.ok && commit.error.length).toBeGreaterThan(0);
  });

  it('rejects option-shaped and invalid branch, start-point, and worktree values before running Git', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    const branchesBefore = git(repository, 'branch', '--list');

    for (const result of await Promise.all([
      manager.switchBranch(repository, '--orphan=evil'),
      manager.switchBranch(repository, '-'),
      manager.createBranch(repository, '-f', undefined, true),
      manager.createBranch(repository, 'ok-name', '--output=/tmp/owned'),
      manager.createBranch(repository, 'ok-name', undefined, 'yes' as unknown as boolean),
      manager.createBranch(repository, 'bad name'),
      manager.deleteBranch(repository, '-D'),
      manager.deleteBranch(repository, 'main', 'true' as unknown as boolean),
      manager.addWorktree(repository, '--help', 'feature', true),
      manager.addWorktree(repository, path.join(repository, '..', 'wt'), '--detach', false),
      manager.addWorktree(repository, path.join(repository, '..', 'wt'), 'feature', true, '-q'),
      manager.removeWorktree(repository, '-f'),
      manager.stage('relative', []),
      manager.fetch(null as unknown as string),
    ])) {
      expect(result).toMatchObject({ ok: false, error: expect.any(String) });
    }
    expect(git(repository, 'branch', '--list')).toBe(branchesBefore);
    expect(git(repository, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
  });

  it('creates, switches, and deletes branches and worktrees with end-of-options argv', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();

    expect(await manager.createBranch(repository, 'feature/one', 'main')).toEqual({ ok: true });
    expect(git(repository, 'branch', '--show-current')).toBe('feature/one');
    expect(await manager.createBranch(repository, 'feature/two', undefined, false)).toEqual({ ok: true });
    expect(git(repository, 'branch', '--show-current')).toBe('feature/one');
    expect(await manager.checkout(repository, 'main')).toEqual({ ok: true });
    expect(git(repository, 'branch', '--show-current')).toBe('main');
    expect(await manager.deleteBranch(repository, 'feature/two')).toEqual({ ok: true });

    const worktree = path.join(temporaryDirectory('janet-git-worktrees-'), 'wt-one');
    expect(await manager.addWorktree(repository, worktree, 'feature/wt', true, 'main')).toEqual({ ok: true });
    expect(git(worktree, 'branch', '--show-current')).toBe('feature/wt');
    expect(await manager.removeWorktree(repository, worktree)).toEqual({ ok: true });
    expect(fs.existsSync(worktree)).toBe(false);
    expect(await manager.addWorktree(repository, worktree, 'feature/one', false)).toEqual({ ok: true });
    expect(git(worktree, 'branch', '--show-current')).toBe('feature/one');
    expect(await manager.removeWorktree(repository, worktree, true)).toEqual({ ok: true });
    expect(await manager.pruneWorktrees(repository)).toEqual({ ok: true });
  });

  it('stops waiting for a stalled Git subprocess and says so instead of leaving the action pending', async () => {
    const repository = initializeRepository();
    const hook = path.join(repository, '.git', 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    // A silent, bounded hook that outlives the inactivity timeout.
    fs.writeFileSync(hook, [
      '#!/bin/sh',
      'cd /',
      'if command -v sleep >/dev/null 2>&1; then sleep 4; else SECONDS=0; while [ "$SECONDS" -lt 4 ]; do :; done; fi',
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(repository, 'staged.txt'), 'staged\n');
    git(repository, 'add', 'staged.txt');
    const manager = new GitManager({ timeouts: { long: 500 } });

    const started = Date.now();
    const result = await manager.commit(repository, 'stalled');

    expect(Date.now() - started).toBeLessThan(3_500);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toMatch(/did not respond for 1 second, so JaneT stopped waiting/);
    expect(git(repository, 'log', '-1', '--pretty=%s')).toBe('base');
    // On Windows, Git's launcher can be stopped while the real git.exe and
    // its hook finish in the background and keep the folder in use. Wait
    // until the repository can actually be removed.
    await vi.waitFor(() => fs.rmSync(repository, { recursive: true, force: true }), { timeout: 20_000, interval: 250 });
  });

  it('previews working-tree diffs on filesystems that report no file id', async () => {
    const repository = initializeRepository();
    const manager = new GitManager();
    fs.writeFileSync(path.join(repository, 'base.txt'), 'working\n');
    const withoutFileId = <T extends object>(stats: T): T => {
      Object.defineProperty(stats, 'ino', { value: 0n, configurable: true });
      return stats;
    };
    const open = fs.promises.open;
    const lstat = fs.promises.lstat;
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation((async (...args: any[]) => {
      const handle = await (open as any).apply(fs.promises, args);
      const stat = handle.stat.bind(handle);
      handle.stat = async (options?: any) => withoutFileId(await stat(options));
      return handle;
    }) as any);
    const lstatSpy = vi.spyOn(fs.promises, 'lstat').mockImplementation((async (...args: any[]) => (
      withoutFileId(await (lstat as any).apply(fs.promises, args))
    )) as any);

    try {
      await expect(manager.diff(repository, 'base.txt', 'unstaged')).resolves.toMatchObject({
        ok: true, value: { originalContent: 'base\n', modifiedContent: 'working\n' },
      });

      // Without a file id, a path whose metadata no longer matches the opened
      // handle is still treated as changed.
      lstatSpy.mockImplementation((async (...args: any[]) => {
        const stats = withoutFileId(await (lstat as any).apply(fs.promises, args));
        Object.defineProperty(stats, 'size', { value: (stats as any).size + 1n, configurable: true });
        return stats;
      }) as any);
      await expect(manager.diff(repository, 'base.txt', 'unstaged')).resolves.toMatchObject({
        ok: false, error: { code: 'CONFLICT' },
      });
    } finally {
      openSpy.mockRestore();
      lstatSpy.mockRestore();
    }
  });
});
