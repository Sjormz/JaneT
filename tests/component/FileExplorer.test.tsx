import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileExplorer from '../../src/renderer/components/FileExplorer';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';

const fsListDir = vi.fn();

function file(name: string) {
  return {
    name,
    path: `/repo/${name}`,
    isDirectory: false,
    isSymlink: false,
    size: 10,
    mtime: '2026-07-14T00:00:00.000Z',
  };
}

beforeEach(() => {
  fsListDir.mockReset();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: { fsListDir },
  });
});

afterEach(() => {
  refreshCoordinator.dispose();
});

describe('FileExplorer live refresh', () => {
  it('reloads the visible directory when the coordinator invalidates it', async () => {
    fsListDir
      .mockResolvedValueOnce([file('before.txt')])
      .mockResolvedValueOnce([file('after.txt')]);

    const view = render(<FileExplorer cwd="/repo" cwdReady isRemote={false} />);
    expect(await screen.findByText('before.txt')).toBeInTheDocument();

    act(() => refreshCoordinator.invalidate('manual', 'files:/repo:visible'));
    expect(await screen.findByText('after.txt')).toBeInTheDocument();
    expect(screen.queryByText('before.txt')).not.toBeInTheDocument();
    expect(fsListDir).toHaveBeenCalledTimes(2);
    expect(fsListDir).toHaveBeenLastCalledWith({ dirPath: '/repo', showHidden: false });

    view.unmount();
  });

  it('does not let an old directory response overwrite newer navigation', async () => {
    let resolveRepo!: (entries: ReturnType<typeof file>[]) => void;
    const repoResult = new Promise<ReturnType<typeof file>[]>((resolve) => { resolveRepo = resolve; });
    fsListDir.mockImplementation(({ dirPath }: { dirPath: string }) => (
      dirPath === '/repo' ? repoResult : Promise.resolve([{ ...file('fresh.txt'), path: '/other/fresh.txt' }])
    ));

    const view = render(<FileExplorer cwd="/repo" cwdReady isRemote={false} />);
    await waitFor(() => expect(fsListDir).toHaveBeenCalledWith({ dirPath: '/repo', showHidden: false }));
    view.rerender(<FileExplorer cwd="/other" cwdReady isRemote={false} />);
    expect(await screen.findByText('fresh.txt')).toBeInTheDocument();

    resolveRepo([file('stale.txt')]);
    await act(async () => { await repoResult; });
    expect(screen.queryByText('stale.txt')).not.toBeInTheDocument();
    expect(screen.getByText('fresh.txt')).toBeInTheDocument();

    view.unmount();
  });

  it('builds POSIX breadcrumb targets from the filesystem root', async () => {
    fsListDir.mockResolvedValue([]);

    const view = render(<FileExplorer cwd="/Users/chris" cwdReady isRemote={false} />);
    await waitFor(() => {
      expect(fsListDir).toHaveBeenCalledWith({ dirPath: '/Users/chris', showHidden: false });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    await waitFor(() => {
      expect(fsListDir).toHaveBeenLastCalledWith({ dirPath: '/Users', showHidden: false });
    });
    view.unmount();
  });
});
