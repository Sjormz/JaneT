import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';
import { useGitRepository } from '../../src/renderer/useGitRepository';

function status(current: string, files: string[] = []) {
  return {
    current,
    tracking: '',
    files: files.map((path) => ({ path, working_dir: 'M', index: ' ', staged: false, unstaged: true })),
    ahead: 0,
    behind: 0,
    created: [],
    deleted: [],
    modified: files,
    renamed: [],
    conflicted: [],
  };
}

const gitFindRepo = vi.fn();
const gitStatus = vi.fn();

beforeEach(() => {
  gitFindRepo.mockReset();
  gitStatus.mockReset();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: { gitFindRepo, gitStatus },
  });
});

afterEach(() => {
  refreshCoordinator.dispose();
});

describe('useGitRepository', () => {
  it('shares a refreshable repository status snapshot without re-discovering the repo', async () => {
    gitFindRepo.mockResolvedValue('/repo');
    gitStatus
      .mockResolvedValueOnce(status('main'))
      .mockResolvedValueOnce(status('feature/live-refresh', ['src/app.ts']))
      .mockResolvedValueOnce(status('feature/live-refresh', ['src/app.ts']));

    const { result, unmount } = renderHook(() => useGitRepository('/repo/src', true));

    await waitFor(() => expect(result.current.status?.current).toBe('main'));
    expect(gitFindRepo).toHaveBeenCalledTimes(1);

    act(() => refreshCoordinator.invalidate('manual', 'git-status:/repo'));
    await waitFor(() => expect(result.current.status?.current).toBe('feature/live-refresh'));
    expect(result.current.status?.files).toHaveLength(1);
    expect(gitFindRepo).toHaveBeenCalledTimes(1);

    const refreshedStatus = result.current.status;
    act(() => refreshCoordinator.invalidate('manual', 'git-status:/repo'));
    await waitFor(() => expect(gitStatus).toHaveBeenCalledTimes(3));
    expect(result.current.status).toBe(refreshedStatus);

    unmount();
  });

  it('ignores a stale status response after the cwd moves to another repository', async () => {
    let resolveOldStatus!: (value: ReturnType<typeof status>) => void;
    const oldStatus = new Promise<ReturnType<typeof status>>((resolve) => { resolveOldStatus = resolve; });
    gitFindRepo.mockImplementation(async ({ startPath }: { startPath: string }) => (
      startPath.startsWith('/one') ? '/one' : '/two'
    ));
    gitStatus.mockImplementation(({ repoPath }: { repoPath: string }) => (
      repoPath === '/one' ? oldStatus : Promise.resolve(status('two-main'))
    ));

    const { result, rerender, unmount } = renderHook(
      ({ cwd }) => useGitRepository(cwd, true),
      { initialProps: { cwd: '/one/src' } },
    );
    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith({ repoPath: '/one' }));

    rerender({ cwd: '/two/src' });
    await waitFor(() => expect(result.current.status?.current).toBe('two-main'));
    resolveOldStatus(status('stale-one'));
    await act(async () => { await oldStatus; });

    expect(result.current.repoPath).toBe('/two');
    expect(result.current.status?.current).toBe('two-main');
    unmount();
  });
});
