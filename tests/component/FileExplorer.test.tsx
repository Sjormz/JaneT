import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileExplorer from '../../src/renderer/components/FileExplorer';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';
import {
  endTerminalPathDrag,
  readTerminalPathDragData,
  TERMINAL_PATH_MIME,
} from '../../src/renderer/terminalPathDrag';

const fsListDir = vi.fn();

const localSource = (cwd: string, ready = true, key = 'local:terminal') => ({
  kind: 'local' as const,
  key,
  cwd,
  ready,
});

function file(name: string) {
  return {
    name,
    path: `/repo/${name}`,
    isDirectory: false,
    isSymlink: false,
    size: 10,
    mtime: '2026-07-14T00:00:00.000Z',
    mode: 0o644,
  };
}

function directory(name: string) {
  return {
    ...file(name),
    path: `/repo/${name}`,
    isDirectory: true,
    mode: 0o755,
  };
}

function dragDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const types: string[] = [];
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    types,
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
      if (!types.includes(type)) types.push(type);
    }),
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    clearData: vi.fn((type?: string) => {
      if (type) {
        values.delete(type);
        const index = types.indexOf(type);
        if (index >= 0) types.splice(index, 1);
      } else {
        values.clear();
        types.splice(0);
      }
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

beforeEach(() => {
  fsListDir.mockReset();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: { fsListDir },
  });
});

afterEach(() => {
  endTerminalPathDrag();
  refreshCoordinator.dispose();
});

describe('FileExplorer live refresh', () => {
  it('does not leave the previous directory actionable while navigation is pending or fails', async () => {
    let rejectNested!: (error: Error) => void;
    const nestedResult = new Promise<ReturnType<typeof file>[]>((_resolve, reject) => { rejectNested = reject; });
    fsListDir.mockResolvedValueOnce([directory('projects')]).mockReturnValueOnce(nestedResult);
    const view = render(<FileExplorer source={localSource('/repo')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder projects' }));
    expect(screen.queryByRole('button', { name: 'Open folder projects' })).toBeNull();
    expect(screen.getByText('Loading…')).toHaveAttribute('role', 'status');
    rejectNested(new Error('permission denied'));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    expect(screen.queryByRole('button', { name: 'Open folder projects' })).toBeNull();
    view.unmount();
  });

  it('reloads the visible directory when the coordinator invalidates it', async () => {
    fsListDir
      .mockResolvedValueOnce([file('before.txt')])
      .mockResolvedValueOnce([file('after.txt')]);

    const view = render(<FileExplorer source={localSource('/repo')} />);
    expect(await screen.findByText('before.txt')).toBeInTheDocument();

    act(() => refreshCoordinator.invalidate('manual', 'files:local:terminal:/repo:visible'));
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

    const view = render(<FileExplorer source={localSource('/repo')} />);
    await waitFor(() => expect(fsListDir).toHaveBeenCalledWith({ dirPath: '/repo', showHidden: false }));
    view.rerender(<FileExplorer source={localSource('/other')} />);
    expect(await screen.findByText('fresh.txt')).toBeInTheDocument();

    resolveRepo([file('stale.txt')]);
    await act(async () => { await repoResult; });
    expect(screen.queryByText('stale.txt')).not.toBeInTheDocument();
    expect(screen.getByText('fresh.txt')).toBeInTheDocument();

    view.unmount();
  });

  it('builds POSIX breadcrumb targets from the filesystem root', async () => {
    fsListDir.mockResolvedValue([]);

    const view = render(<FileExplorer source={localSource('/Users/chris')} />);
    await waitFor(() => {
      expect(fsListDir).toHaveBeenCalledWith({ dirPath: '/Users/chris', showHidden: false });
    });

    expect(screen.queryByRole('navigation', { name: 'Folder location' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse parent folders' }));
    expect(screen.getByRole('button', { name: 'Browse parent folders' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Users' }));

    await waitFor(() => {
      expect(fsListDir).toHaveBeenLastCalledWith({ dirPath: '/Users', showHidden: false });
    });
    view.unmount();
  });

  it('exposes directories as keyboard-operable folder buttons', async () => {
    fsListDir
      .mockResolvedValueOnce([directory('src'), file('README.md')])
      .mockResolvedValueOnce([]);

    const onOpenFile = vi.fn();
    const view = render(
      <FileExplorer source={localSource('/repo')} onOpenFile={onOpenFile} />,
    );
    const folder = await screen.findByRole('button', { name: 'Open folder src' });

    expect(screen.getByRole('button', { name: 'Open file README.md' })).toBeInTheDocument();
    fireEvent.click(folder);

    await waitFor(() => {
      expect(fsListDir).toHaveBeenLastCalledWith({ dirPath: '/repo/src', showHidden: false });
    });
    expect(onOpenFile).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens a local file with its absolute Explorer path', async () => {
    fsListDir.mockResolvedValueOnce([file('README.md')]);
    const onOpenFile = vi.fn();

    const view = render(
      <FileExplorer source={localSource('/repo')} onOpenFile={onOpenFile} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open file README.md' }));

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith({ kind: 'local', path: '/repo/README.md' });
    expect(fsListDir).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('drags local files and folders with typed absolute-path payloads without breaking folder navigation', async () => {
    fsListDir
      .mockResolvedValueOnce([directory('src'), file('README.md')])
      .mockResolvedValueOnce([]);

    const onCopyTerminalPath = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <FileExplorer source={localSource('/repo')} onCopyTerminalPath={onCopyTerminalPath} />,
    );
    const fileItem = (await screen.findByText('README.md')).closest('.explorer-item')!;
    const folder = screen.getByRole('button', { name: 'Open folder src' });

    const fileTransfer = dragDataTransfer();
    fireEvent.dragStart(fileItem, { dataTransfer: fileTransfer });
    expect(fileTransfer.effectAllowed).toBe('copy');
    expect(fileTransfer.types).toContain(TERMINAL_PATH_MIME);
    expect(fileTransfer.getData('text/plain')).toBe('/repo/README.md');
    expect(readTerminalPathDragData(fileTransfer)).toEqual({
      version: 1,
      path: '/repo/README.md',
      entryKind: 'file',
      origin: 'explorer',
      filesystem: { kind: 'local' },
    });
    fireEvent.dragEnd(fileItem, { dataTransfer: fileTransfer });

    const folderTransfer = dragDataTransfer();
    fireEvent.dragStart(folder, { dataTransfer: folderTransfer });
    expect(folderTransfer.getData('text/plain')).toBe('/repo/src');
    expect(readTerminalPathDragData(folderTransfer)).toEqual({
      version: 1,
      path: '/repo/src',
      entryKind: 'directory',
      origin: 'explorer',
      filesystem: { kind: 'local' },
    });
    fireEvent.dragEnd(folder, { dataTransfer: folderTransfer });

    const fileCopy = screen.getByRole('button', { name: 'Copy path for README.md' });
    expect(fileCopy).not.toHaveAttribute('draggable', 'true');
    fireEvent.click(fileCopy);
    await waitFor(() => expect(onCopyTerminalPath).toHaveBeenCalledWith('/repo/README.md'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy path for src' }));
    await waitFor(() => expect(onCopyTerminalPath).toHaveBeenCalledWith('/repo/src'));
    expect(fsListDir).toHaveBeenCalledTimes(1);

    fireEvent.click(folder);
    await waitFor(() => {
      expect(fsListDir).toHaveBeenLastCalledWith({ dirPath: '/repo/src', showHidden: false });
    });
    view.unmount();
  });

  it('prevents Explorer drags whose paths are unsafe to paste into a terminal', async () => {
    fsListDir.mockResolvedValueOnce([{
      ...file('unsafe.txt'),
      path: '/repo/unsafe\npath.txt',
    }]);

    const view = render(<FileExplorer source={localSource('/repo')} />);
    const fileItem = (await screen.findByText('unsafe.txt')).closest('.explorer-item')!;
    const transfer = dragDataTransfer();

    expect(fireEvent.dragStart(fileItem, { dataTransfer: transfer })).toBe(false);
    expect(transfer.setData).not.toHaveBeenCalled();
    expect(transfer.getData('text/plain')).toBe('');
    expect(screen.getByRole('button', { name: 'Copy path for unsafe.txt' }))
      .toHaveAttribute('aria-disabled', 'true');
    view.unmount();
  });

  it('shows terminal startup instead of a false empty-directory state before cwd is ready', () => {
    fsListDir.mockResolvedValue([]);

    const view = render(<FileExplorer source={localSource('', false)} />);

    expect(screen.getByRole('status')).toHaveTextContent('Starting terminal…');
    expect(screen.queryByText('Empty directory')).toBeNull();
    expect(fsListDir).not.toHaveBeenCalled();
    view.unmount();
  });

});
