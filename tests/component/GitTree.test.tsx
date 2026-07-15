import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitTree from '../../src/renderer/components/GitTree';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';
import type { GitStatusResult } from '../../src/renderer/useGitRepository';

const gitDetails = vi.fn();
const getSettings = vi.fn(() => Promise.resolve({}));

const cleanStatus: GitStatusResult = {
  current: 'main',
  files: [],
  ahead: 0,
  behind: 0,
  created: [],
  modified: [],
  deleted: [],
  conflicted: [],
};

function details(branch: string) {
  return {
    branches: [{ name: branch, current: true, label: branch, isRemote: false }],
    worktrees: [{ path: '/repo', head: 'abc123', branch, bare: false, detached: false }],
  };
}

beforeEach(() => {
  gitDetails.mockReset();
  getSettings.mockClear();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: { gitDetails, getSettings },
  });
});

afterEach(() => {
  refreshCoordinator.dispose();
});

describe('GitTree live refresh', () => {
  it('refreshes branch and worktree details without issuing a duplicate status request', async () => {
    gitDetails
      .mockResolvedValueOnce(details('main'))
      .mockResolvedValueOnce(details('feature/heartbeat'));

    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={cleanStatus}
        searching={false}
      />,
    );

    expect(await screen.findByText('repo')).toBeInTheDocument();
    expect(await screen.findAllByText('main')).not.toHaveLength(0);

    act(() => refreshCoordinator.invalidate('manual', 'git-details:/repo'));
    expect(await screen.findAllByText('feature/heartbeat')).not.toHaveLength(0);
    expect(gitDetails).toHaveBeenCalledTimes(2);
    expect(gitDetails).toHaveBeenLastCalledWith({ repoPath: '/repo' });

    view.unmount();
  });

  it('uses the live status branch while slower branch details catch up', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const staleDetails = {
      branches: [
        { name: 'main', current: true, label: 'main', isRemote: false },
        { name: 'feature/heartbeat', current: false, label: 'feature/heartbeat', isRemote: false },
      ],
      worktrees: [{ path: '/repo', head: 'abc123', branch: 'main', bare: false, detached: false }],
    };
    gitDetails.mockResolvedValue(staleDetails);

    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={cleanStatus}
        searching={false}
      />,
    );
    expect(await screen.findByTitle('Switch to feature/heartbeat')).toBeInTheDocument();

    view.rerender(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={{ ...cleanStatus, current: 'feature/heartbeat' }}
        searching={false}
      />,
    );

    expect(screen.getByTitle('Current branch')).toHaveTextContent('feature/heartbeat');
    expect(screen.getByTitle('Switch to main')).toBeInTheDocument();
    expect(screen.getAllByText('feature/heartbeat')).not.toHaveLength(0);
    await waitFor(() => expect(gitDetails).toHaveBeenCalledTimes(2));
    view.unmount();
    hasFocus.mockRestore();
  });

  it('renders each conflicted file once and preserves its conflict state in both views', async () => {
    gitDetails.mockResolvedValue(details('main'));
    const conflictedStatus: GitStatusResult = {
      ...cleanStatus,
      files: [{ path: 'src/conflict.ts', working_dir: 'U', index: 'U', staged: false, unstaged: false }],
      conflicted: ['src/conflict.ts'],
    };

    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={conflictedStatus}
        searching={false}
      />,
    );

    await screen.findByText('repo');
    expect(screen.getByRole('button', { name: /Changes/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('conflict.ts')).toHaveLength(1);
    expect(screen.getByText('conflict.ts').closest('.git-file-item')).toHaveClass('conflicted');

    fireEvent.click(screen.getByTitle('Switch to tree view'));
    expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('conflict.ts')).toHaveLength(1);
    expect(screen.getByText('conflict.ts').closest('.git-file-item')).toHaveClass('conflicted');
    view.unmount();
  });

  it('shows files that are both staged and modified as mixed instead of hiding the working-tree change', async () => {
    gitDetails.mockResolvedValue(details('main'));
    const mixedStatus: GitStatusResult = {
      ...cleanStatus,
      files: [{ path: 'src/mixed.ts', working_dir: 'M', index: 'M', staged: true, unstaged: true }],
    };

    const view = render(
      <GitTree cwdReady isRemote={false} repoPath="/repo" status={mixedStatus} searching={false} />,
    );
    const file = await screen.findByText('mixed.ts');
    expect(file.closest('.git-file-item')).toHaveClass('mixed');
    expect(file.closest('.git-file-item')).toHaveAttribute('title', 'Staged and modified in working tree');
    view.unmount();
  });
});
