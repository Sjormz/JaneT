import { describe, expect, it } from 'vitest';
import { buildAddWorktreeArgs, normalizeGitStatus } from '../../src/main/git';

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
