import { describe, expect, it } from 'vitest';
import { formatGitStatusTitle, summarizeGitStatus } from '../../src/renderer/gitStatus';

describe('summarizeGitStatus', () => {
  it('counts changed, staged, conflicted, ahead and behind state', () => {
    const summary = summarizeGitStatus('C:/repo', {
      current: 'main',
      ahead: 2,
      behind: 1,
      conflicted: ['src/conflict.ts'],
      files: [
        { path: 'src/app.ts', staged: true },
        { path: 'src/view.tsx', staged: false },
      ],
    });

    expect(summary).toEqual({
      repoPath: 'C:/repo',
      branch: 'main',
      ahead: 2,
      behind: 1,
      changed: 2,
      staged: 1,
      conflicted: 1,
    });
    expect(formatGitStatusTitle(summary)).toBe('C:/repo · main · ahead 2 · behind 1 · 2 changed · 1 staged · 1 conflicted');
  });
});
