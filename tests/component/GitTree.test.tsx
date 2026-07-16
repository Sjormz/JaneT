import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GitTree from '../../src/renderer/components/GitTree';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';
import { TERMINAL_PATH_MIME } from '../../src/renderer/terminalPathDrag';
import type { GitStatusResult } from '../../src/renderer/useGitRepository';

const gitDetails = vi.fn();
const gitDeleteBranch = vi.fn();
const gitRemoveWorktree = vi.fn();
const gitPruneWorktrees = vi.fn();
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

const destructiveDetails = {
  branches: [
    { name: 'main', current: true, label: 'main', isRemote: false },
    { name: 'feature/cleanup', current: false, label: 'feature/cleanup', isRemote: false },
  ],
  worktrees: [
    { path: '/repo', head: 'abc123', branch: 'main', bare: false, detached: false },
    { path: '/worktrees/repo-feature', head: 'def456', branch: 'feature/cleanup', bare: false, detached: false },
  ],
};

function createDataTransfer() {
  const data = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: 'none',
    setData: vi.fn((type: string, value: string) => data.set(type, value)),
    getData: vi.fn((type: string) => data.get(type) ?? ''),
  } as unknown as DataTransfer;
  return { data, dataTransfer };
}

beforeEach(() => {
  gitDetails.mockReset();
  gitDeleteBranch.mockReset().mockResolvedValue(true);
  gitRemoveWorktree.mockReset().mockResolvedValue(true);
  gitPruneWorktrees.mockReset().mockResolvedValue(true);
  getSettings.mockClear();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: {
      gitDetails,
      gitDeleteBranch,
      gitRemoveWorktree,
      gitPruneWorktrees,
      getSettings,
    },
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
    expect(await screen.findByRole('button', { name: 'Switch to branch feature/heartbeat' })).toBeInTheDocument();

    view.rerender(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={{ ...cleanStatus, current: 'feature/heartbeat' }}
        searching={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Current branch feature/heartbeat' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Switch to branch main' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Show changes as a folder tree' }));
    expect(screen.getByRole('button', { name: 'src' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText('conflict.ts')).toHaveLength(1);
    expect(screen.getByText('conflict.ts').closest('.git-file-item')).toHaveClass('conflicted');
    view.unmount();
  });

  it('shows files that are both staged and modified as mixed instead of hiding the working-tree change', async () => {
    gitDetails.mockResolvedValue(details('main'));
    const onOpenFile = vi.fn();
    const mixedStatus: GitStatusResult = {
      ...cleanStatus,
      files: [{ path: 'src/mixed.ts', working_dir: 'M', index: 'M', staged: true, unstaged: true }],
    };

    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={mixedStatus}
        searching={false}
        onOpenFile={onOpenFile}
      />,
    );
    const file = await screen.findByText('mixed.ts');
    const fileButton = file.closest('.git-file-item')!;
    expect(fileButton).toHaveClass('mixed');
    expect(fileButton).toHaveAttribute(
      'aria-label',
      'Open file src/mixed.ts: Staged and modified in working tree',
    );

    fireEvent.click(fileButton);
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith({ kind: 'local', path: '/repo/src/mixed.ts' });
    view.unmount();
  });

  it('explains deleted entries to keyboard users and never opens their missing path', async () => {
    gitDetails.mockResolvedValue(details('main'));
    const onOpenFile = vi.fn();
    const deletedStatus: GitStatusResult = {
      ...cleanStatus,
      files: [{ path: 'src/removed.ts', working_dir: ' ', index: 'D', staged: true, unstaged: false }],
      deleted: ['src/removed.ts'],
    };

    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={deletedStatus}
        searching={false}
        onOpenFile={onOpenFile}
      />,
    );
    const deleted = await screen.findByRole('button', {
      name: 'src/removed.ts: Deleted from the working tree',
    });

    deleted.focus();
    expect(deleted).toHaveFocus();
    expect(deleted).toHaveAttribute('aria-disabled', 'true');
    expect(deleted).toHaveAttribute(
      'data-tooltip-label',
      'src/removed.ts: Deleted from the working tree; there is no file to open',
    );
    fireEvent.keyDown(deleted, { key: 'Enter' });
    fireEvent.click(deleted);
    expect(onOpenFile).not.toHaveBeenCalled();
    view.unmount();
  });

  it('drags flat changed files with an absolute local Source Control payload', () => {
    gitDetails.mockResolvedValue(details('main'));
    const changedStatus: GitStatusResult = {
      ...cleanStatus,
      files: [{ path: 'src/mixed.ts', working_dir: 'M', index: 'M', staged: true, unstaged: true }],
    };
    const onCopyTerminalPath = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="/repo"
        status={changedStatus}
        searching={false}
        onCopyTerminalPath={onCopyTerminalPath}
      />,
    );
    const row = screen.getByText('mixed.ts').closest('.git-file-item')!;
    const { data, dataTransfer } = createDataTransfer();

    expect(row).toHaveAttribute('draggable', 'true');
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(data.get('text/plain')).toBe('/repo/src/mixed.ts');
    expect(JSON.parse(data.get(TERMINAL_PATH_MIME)!)).toEqual({
      version: 1,
      path: '/repo/src/mixed.ts',
      entryKind: 'file',
      origin: 'source-control',
      filesystem: { kind: 'local' },
    });
    expect(row).toHaveAttribute('aria-label', 'Open file src/mixed.ts: Staged and modified in working tree');
    const copyButton = screen.getByRole('button', { name: 'Copy path for src/mixed.ts' });
    expect(copyButton).not.toHaveAttribute('draggable', 'true');
    fireEvent.click(copyButton);
    expect(onCopyTerminalPath).toHaveBeenCalledWith('/repo/src/mixed.ts');

    fireEvent.dragEnd(row, { dataTransfer });
    view.unmount();
  });

  it('keeps the same changed-file drag payload in tree view without making action controls draggable', async () => {
    gitDetails.mockResolvedValue(details('main'));
    const changedStatus: GitStatusResult = {
      ...cleanStatus,
      files: [{ path: 'src/nested/app.ts', working_dir: 'M', index: ' ', staged: false, unstaged: true }],
    };
    const onCopyTerminalPath = vi.fn().mockResolvedValue(undefined);
    const onOpenFile = vi.fn();
    const view = render(
      <GitTree
        cwdReady
        isRemote={false}
        repoPath="C:/repo"
        status={changedStatus}
        searching={false}
        onCopyTerminalPath={onCopyTerminalPath}
        onOpenFile={onOpenFile}
      />,
    );

    const viewToggle = screen.getByRole('button', { name: 'Show changes as a folder tree' });
    fireEvent.click(viewToggle);
    const folder = screen.getByRole('button', { name: 'src' });
    const row = screen.getByText('app.ts').closest('.git-file-item')!;
    const { data, dataTransfer } = createDataTransfer();

    fireEvent.dragStart(row, { dataTransfer });
    expect(JSON.parse(data.get(TERMINAL_PATH_MIME)!)).toEqual({
      version: 1,
      path: 'C:/repo/src/nested/app.ts',
      entryKind: 'file',
      origin: 'source-control',
      filesystem: { kind: 'local' },
    });
    expect(data.get('text/plain')).toBe('C:/repo/src/nested/app.ts');

    expect(folder).not.toHaveAttribute('draggable');
    expect(screen.getByRole('button', { name: 'Show changes as a flat list' })).not.toHaveAttribute('draggable');
    expect(await screen.findByRole('button', { name: 'Current branch main' })).not.toHaveAttribute('draggable');
    expect(await screen.findByRole('button', { name: 'Open worktree repo in a terminal' })).not.toHaveAttribute('draggable');
    fireEvent.click(screen.getByRole('button', { name: 'Copy path for src/nested/app.ts' }));
    expect(onCopyTerminalPath).toHaveBeenCalledWith('C:/repo/src/nested/app.ts');

    fireEvent.dragEnd(row, { dataTransfer });
    fireEvent.click(row);
    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith({ kind: 'local', path: 'C:/repo/src/nested/app.ts' });
    view.unmount();
  });
});

describe('GitTree destructive actions', () => {
  it('keeps branch deletion behind the dialog and restores its opener on Escape', async () => {
    gitDetails.mockResolvedValue(destructiveDetails);
    render(<GitTree cwdReady isRemote={false} repoPath="/repo" status={cleanStatus} searching={false} />);

    const opener = await screen.findByRole('button', { name: 'Delete branch feature/cleanup' });
    opener.focus();
    fireEvent.click(opener);

    const forceInput = screen.getByLabelText('Type FORCE to delete even with unmerged work. Leave blank for a safe delete.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(gitDeleteBranch).not.toHaveBeenCalled();

    fireEvent.keyDown(forceInput, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Delete feature/cleanup' })).not.toBeInTheDocument();
    expect(gitDeleteBranch).not.toHaveBeenCalled();
    await waitFor(() => expect(opener).toHaveFocus());

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(gitDeleteBranch).toHaveBeenCalledWith({
      repoPath: '/repo',
      branch: 'feature/cleanup',
      force: false,
    }));
  });

  it('keeps worktree removal behind cancel and forwards explicit force confirmation', async () => {
    gitDetails.mockResolvedValue(destructiveDetails);
    render(<GitTree cwdReady isRemote={false} repoPath="/repo" status={cleanStatus} searching={false} />);

    const opener = await screen.findByRole('button', { name: 'Remove worktree repo-feature' });
    fireEvent.click(opener);

    const forceInput = screen.getByLabelText('Type FORCE to remove even with local changes. Leave blank for a safe removal.');
    expect(screen.getByRole('dialog', { name: 'Remove repo-feature' })).toHaveAccessibleDescription(
      /Remove the Git worktree at \/worktrees\/repo-feature.*deletes that worktree directory/i,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(gitRemoveWorktree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(gitRemoveWorktree).not.toHaveBeenCalled();

    fireEvent.click(opener);
    fireEvent.change(screen.getByLabelText('Type FORCE to remove even with local changes. Leave blank for a safe removal.'), {
      target: { value: 'FORCE' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(gitRemoveWorktree).toHaveBeenCalledWith({
      repoPath: '/repo',
      worktreePath: '/worktrees/repo-feature',
      force: true,
    }));
  });

  it('focuses Cancel and keeps pruning behind a descriptive confirmation', async () => {
    gitDetails.mockResolvedValue(destructiveDetails);
    render(<GitTree cwdReady isRemote={false} repoPath="/repo" status={cleanStatus} searching={false} />);

    const openPruneDialog = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Worktree actions' }));
      fireEvent.click(screen.getByRole('button', { name: 'Prune stale worktrees…' }));
    };

    openPruneDialog();
    const dialog = screen.getByRole('dialog', { name: 'Prune stale worktrees' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/Working directories are not deleted/i);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(gitPruneWorktrees).not.toHaveBeenCalled();

    fireEvent.click(cancel);
    expect(gitPruneWorktrees).not.toHaveBeenCalled();

    openPruneDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Prune' }));
    await waitFor(() => expect(gitPruneWorktrees).toHaveBeenCalledWith({ repoPath: '/repo' }));
  });
});
