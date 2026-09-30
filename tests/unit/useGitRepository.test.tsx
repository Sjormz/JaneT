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

function ok(value: ReturnType<typeof status>) {
  return { ok: true as const, value };
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
      .mockResolvedValueOnce(ok(status('main')))
      .mockResolvedValueOnce(ok(status('feature/live-refresh', ['src/app.ts'])))
      .mockResolvedValueOnce(ok(status('feature/live-refresh', ['src/app.ts'])));

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
    let resolveOldStatus!: (value: ReturnType<typeof ok>) => void;
    const oldStatus = new Promise<ReturnType<typeof ok>>((resolve) => { resolveOldStatus = resolve; });
    gitFindRepo.mockImplementation(async ({ startPath }: { startPath: string }) => (
      startPath.startsWith('/one') ? '/one' : '/two'
    ));
    gitStatus.mockImplementation(({ repoPath }: { repoPath: string }) => (
      repoPath === '/one' ? oldStatus : Promise.resolve(ok(status('two-main')))
    ));

    const { result, rerender, unmount } = renderHook(
      ({ cwd }) => useGitRepository(cwd, true),
      { initialProps: { cwd: '/one/src' } },
    );
    await waitFor(() => expect(gitStatus).toHaveBeenCalledWith({ repoPath: '/one' }));

    rerender({ cwd: '/two/src' });
    await waitFor(() => expect(result.current.status?.current).toBe('two-main'));
    resolveOldStatus(ok(status('stale-one')));
    await act(async () => { await oldStatus; });

    expect(result.current.repoPath).toBe('/two');
    expect(result.current.status?.current).toBe('two-main');
    unmount();
  });

  it('reports a failed first read as an error without inventing a status', async () => {
    gitFindRepo.mockResolvedValue('/repo');
    gitStatus.mockResolvedValue({ ok: false, error: 'fatal: not a git repository' });

    const { result, unmount } = renderHook(() => useGitRepository('/repo', true));

    await waitFor(() => expect(result.current.error).toBe('fatal: not a git repository'));
    expect(result.current.status).toBeNull();
    expect(result.current.stale).toBe(false);
    unmount();
  });

  it('marks the last good snapshot stale after a failure and clears it on recovery', async () => {
    gitFindRepo.mockResolvedValue('/repo');
    gitStatus
      .mockResolvedValueOnce(ok(status('main', ['a.ts'])))
      .mockResolvedValueOnce({ ok: false, error: 'Git did not respond for 20 seconds, so JaneT stopped waiting.' })
      .mockRejectedValueOnce(new Error('IPC channel closed'))
      .mockResolvedValueOnce(ok(status('main')));

    const { result, unmount } = renderHook(() => useGitRepository('/repo', true));
    await waitFor(() => expect(result.current.status?.files).toHaveLength(1));
    expect(result.current).toMatchObject({ error: null, stale: false });
    const snapshot = result.current.status;

    act(() => refreshCoordinator.invalidate('manual', 'git-status:/repo'));
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.error).toMatch(/did not respond/);
    expect(result.current.status).toBe(snapshot);

    act(() => refreshCoordinator.invalidate('manual', 'git-status:/repo'));
    await waitFor(() => expect(result.current.error).toBe('IPC channel closed'));
    expect(result.current.stale).toBe(true);

    act(() => refreshCoordinator.invalidate('manual', 'git-status:/repo'));
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.status?.files).toHaveLength(0);
    unmount();
  });
});
