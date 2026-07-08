import { describe, expect, it } from 'vitest';
import {
  defaultWorktreePath,
  parseWorktreePorcelain,
  sanitizeBranchForPath,
} from '../../src/shared/gitWorktrees';

describe('parseWorktreePorcelain', () => {
  it('parses branch, detached, locked and prunable worktrees', () => {
    const raw = [
      'worktree C:/repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree C:/repo-feature',
      'HEAD def456',
      'branch refs/heads/feature/git-ui',
      'locked testing',
      '',
      'worktree C:/repo-detached',
      'HEAD feed00',
      'detached',
      'prunable stale',
      '',
    ].join('\0');

    expect(parseWorktreePorcelain(raw)).toEqual([
      { path: 'C:/repo', head: 'abc123', branch: 'main', bare: false, detached: false },
      { path: 'C:/repo-feature', head: 'def456', branch: 'feature/git-ui', bare: false, detached: false, locked: 'testing' },
      { path: 'C:/repo-detached', head: 'feed00', bare: false, detached: true, prunable: 'stale' },
    ]);
  });
});

describe('defaultWorktreePath', () => {
  it('uses a sibling dir and sanitizes branch names by default', () => {
    expect(defaultWorktreePath('C:/Users/pckpr/projects/JaneT', 'feature/git ui')).toBe(
      'C:/Users/pckpr/projects/JaneT-feature-git-ui',
    );
  });

  it('supports absolute base dirs and templates', () => {
    expect(defaultWorktreePath('C:/repo/JaneT', 'bug/fix', 'D:/trees', '{branch}')).toBe('D:/trees/bug-fix');
    expect(sanitizeBranchForPath('refs/heads/feature/a b')).toBe('feature-a-b');
  });
});
