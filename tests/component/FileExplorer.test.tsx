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
const sshListDir = vi.fn();

const localSource = (cwd: string, ready = true, key = 'local:terminal') => ({
  kind: 'local' as const,
  key,
  cwd,
  ready,
});

const sshSource = (sessionId: string, ready = true, host = 'box.local') => ({
  kind: 'ssh' as const,
  key: `ssh:terminal:${sessionId}`,
  sessionId,
  ready,
  label: host,
  connectionState: ready ? 'ready' as const : 'connecting' as const,
});

const remoteListing = (
  resolvedPath: string,
  entries: Array<ReturnType<typeof file>>,
  connectionId = 'connection-current',
) => ({
  connectionId,
  resolvedPath,
  entries,
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
  sshListDir.mockReset();
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: { fsListDir, sshListDir },
  });
});

afterEach(() => {
  endTerminalPathDrag();
  refreshCoordinator.dispose();
});

describe('FileExplorer live refresh', () => {
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

  it('opens an SSH file with the exact session and connection identity from its listing', async () => {
    sshListDir.mockResolvedValueOnce(remoteListing('/srv/project', [{
      ...file('remote.ts'),
      path: '/srv/project/remote.ts',
    }], 'transport-connection-42'));
    const onOpenFile = vi.fn();

    const view = render(
      <FileExplorer
        source={sshSource('ssh-editor', true, 'editor.example')}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open file remote.ts' }));

    expect(onOpenFile).toHaveBeenCalledOnce();
    expect(onOpenFile).toHaveBeenCalledWith({
      kind: 'ssh',
      sessionId: 'ssh-editor',
      connectionId: 'transport-connection-42',
      path: '/srv/project/remote.ts',
      label: 'editor.example',
    });
    expect(fsListDir).not.toHaveBeenCalled();
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

  it('includes the SSH session and canonical remote path in Explorer drag payloads', async () => {
    sshListDir.mockResolvedValueOnce(remoteListing('/srv/project', [{
      ...file('remote file.ts'),
      path: '/srv/project/remote file.ts',
    }]));

    const view = render(<FileExplorer source={sshSource('ssh-drag')} />);
    const fileItem = (await screen.findByText('remote file.ts')).closest('.explorer-item')!;
    const transfer = dragDataTransfer();

    fireEvent.dragStart(fileItem, { dataTransfer: transfer });

    expect(transfer.getData('text/plain')).toBe('/srv/project/remote file.ts');
    expect(readTerminalPathDragData(transfer)).toEqual({
      version: 1,
      path: '/srv/project/remote file.ts',
      entryKind: 'file',
      origin: 'explorer',
      filesystem: { kind: 'ssh', sessionId: 'ssh-drag' },
    });
    fireEvent.dragEnd(fileItem, { dataTransfer: transfer });
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

  it('browses the authenticated SSH session without reading the local filesystem', async () => {
    sshListDir
      .mockResolvedValueOnce(remoteListing('/home/janet', [{ ...directory('projects'), path: '/home/janet/projects' }]))
      .mockResolvedValueOnce(remoteListing('/home/janet/projects', [{ ...file('remote.txt'), path: '/home/janet/projects/remote.txt' }]));

    const view = render(<FileExplorer source={sshSource('ssh-1')} />);

    expect(await screen.findByText('projects')).toBeInTheDocument();
    expect(screen.getByText(/files on/i)).toHaveTextContent('box.local');
    expect(sshListDir).toHaveBeenCalledWith({
      sessionId: 'ssh-1',
      showHidden: false,
    });
    expect(fsListDir).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open folder projects' }));
    expect(await screen.findByText('remote.txt')).toBeInTheDocument();
    expect(sshListDir).toHaveBeenLastCalledWith({
      sessionId: 'ssh-1',
      remotePath: '/home/janet/projects',
      showHidden: false,
    });
    view.unmount();
  });

  it('keeps navigation separate for each SSH session', async () => {
    sshListDir.mockImplementation(({ sessionId, remotePath }: { sessionId: string; remotePath?: string }) => {
      if (sessionId === 'ssh-a' && remotePath === undefined) {
        return Promise.resolve(remoteListing('/home/a', [{ ...directory('src'), path: '/home/a/src' }]));
      }
      if (sessionId === 'ssh-a' && remotePath === '/home/a') {
        return Promise.resolve(remoteListing('/home/a', [{ ...directory('src'), path: '/home/a/src' }]));
      }
      const resolvedPath = remotePath ?? (sessionId === 'ssh-a' ? '/home/a' : '/srv/b');
      return Promise.resolve(remoteListing(resolvedPath, []));
    });

    const view = render(<FileExplorer source={sshSource('ssh-a', true, 'a.local')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder src' }));
    await waitFor(() => expect(sshListDir).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ssh-a', remotePath: '/home/a/src',
    })));

    view.rerender(<FileExplorer source={sshSource('ssh-b', true, 'b.local')} />);
    await waitFor(() => expect(sshListDir).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ssh-b', showHidden: false,
    })));
    expect(screen.getByRole('button', { name: 'b' })).toBeInTheDocument();

    view.rerender(<FileExplorer source={sshSource('ssh-a', true, 'a.local')} />);
    await waitFor(() => expect(sshListDir).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: 'ssh-a', remotePath: '/home/a/src',
    })));
    expect(sshListDir.mock.calls.filter(([params]) => params.remotePath === undefined)).toHaveLength(2);
    view.unmount();
  });

  it('does not let a response from another SSH session overwrite the active source', async () => {
    let resolveA!: (listing: ReturnType<typeof remoteListing>) => void;
    const resultA = new Promise<ReturnType<typeof remoteListing>>((resolve) => { resolveA = resolve; });
    sshListDir.mockImplementation(({ sessionId }: { sessionId: string }) => (
      sessionId === 'ssh-a'
        ? resultA
        : Promise.resolve(remoteListing('/home/shared', [{ ...file('from-b.txt'), path: '/home/shared/from-b.txt' }]))
    ));

    const view = render(<FileExplorer source={sshSource('ssh-a')} />);
    await waitFor(() => expect(sshListDir).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'ssh-a' })));
    view.rerender(<FileExplorer source={sshSource('ssh-b')} />);
    expect(await screen.findByText('from-b.txt')).toBeInTheDocument();

    resolveA(remoteListing('/home/shared', [{ ...file('stale-a.txt'), path: '/home/shared/stale-a.txt' }]));
    await act(async () => { await resultA; });
    expect(screen.queryByText('stale-a.txt')).toBeNull();
    expect(screen.getByText('from-b.txt')).toBeInTheDocument();
    view.unmount();
  });

  it('hides the previous source immediately while the next SSH session loads', async () => {
    let resolveB!: (listing: ReturnType<typeof remoteListing>) => void;
    const resultB = new Promise<ReturnType<typeof remoteListing>>((resolve) => { resolveB = resolve; });
    sshListDir.mockImplementation(({ sessionId }: { sessionId: string }) => (
      sessionId === 'ssh-a'
        ? Promise.resolve(remoteListing('/home/a', [{
          ...file('private-a.txt'), path: '/home/a/private-a.txt',
        }]))
        : resultB
    ));

    const view = render(<FileExplorer source={sshSource('ssh-a', true, 'a.local')} />);
    expect(await screen.findByText('private-a.txt')).toBeInTheDocument();

    view.rerender(<FileExplorer source={sshSource('ssh-b', true, 'b.local')} />);
    expect(screen.queryByText('private-a.txt')).toBeNull();
    expect(screen.getByText(/files on/i)).toHaveTextContent('b.local');
    expect(screen.getByText('Loading…')).toHaveAttribute('role', 'status');

    resolveB(remoteListing('/home/b', [{ ...file('from-b.txt'), path: '/home/b/from-b.txt' }]));
    expect(await screen.findByText('from-b.txt')).toBeInTheDocument();
    view.unmount();
  });

  it('does not leave the previous directory actionable while navigation is pending or fails', async () => {
    let rejectNested!: (error: Error) => void;
    const nestedResult = new Promise<ReturnType<typeof remoteListing>>((_resolve, reject) => {
      rejectNested = reject;
    });
    sshListDir
      .mockResolvedValueOnce(remoteListing('/home/janet', [{
        ...directory('projects'), path: '/home/janet/projects',
      }]))
      .mockReturnValueOnce(nestedResult);

    const view = render(<FileExplorer source={sshSource('ssh-navigation')} />);
    const folder = await screen.findByRole('button', { name: 'Open folder projects' });
    fireEvent.click(folder);

    expect(screen.queryByRole('button', { name: 'Open folder projects' })).toBeNull();
    expect(screen.getByText('Loading…')).toHaveAttribute('role', 'status');

    rejectNested(new Error('permission denied'));
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    expect(screen.queryByRole('button', { name: 'Open folder projects' })).toBeNull();
    view.unmount();
  });

  it('waits for the SSH transport before opening the remote filesystem', () => {
    const view = render(<FileExplorer source={sshSource('ssh-pending', false)} />);

    expect(screen.getByText('Connecting to files on box.local…')).toHaveAttribute('role', 'status');
    expect(sshListDir).not.toHaveBeenCalled();
    expect(fsListDir).not.toHaveBeenCalled();
    view.unmount();
  });

  it('shows an unavailable state after an established SSH connection closes', () => {
    const source = {
      ...sshSource('ssh-closed', false),
      connectionState: 'disconnected' as const,
    };
    const view = render(<FileExplorer source={source} />);

    expect(screen.getByText(/Reconnect .* to browse its files/i)).toHaveAttribute('role', 'status');
    expect(sshListDir).not.toHaveBeenCalled();
    expect(fsListDir).not.toHaveBeenCalled();
    view.unmount();
  });

  it('requires a fresh listing after reconnecting the same SSH session', async () => {
    let resolveReconnected!: (listing: ReturnType<typeof remoteListing>) => void;
    const reconnectedListing = new Promise<ReturnType<typeof remoteListing>>((resolve) => {
      resolveReconnected = resolve;
    });
    sshListDir
      .mockResolvedValueOnce(remoteListing('/home/janet', [{
        ...file('before-disconnect.txt'), path: '/home/janet/before-disconnect.txt',
      }]))
      .mockReturnValueOnce(reconnectedListing);

    const view = render(<FileExplorer source={sshSource('ssh-reconnect')} />);
    expect(await screen.findByText('before-disconnect.txt')).toBeInTheDocument();

    const disconnectedSource = {
      ...sshSource('ssh-reconnect', false),
      key: 'ssh:terminal:ssh-reconnect:1',
      connectionState: 'disconnected' as const,
    };
    view.rerender(<FileExplorer source={disconnectedSource} />);
    expect(screen.queryByText('before-disconnect.txt')).toBeNull();

    view.rerender(<FileExplorer source={{
      ...sshSource('ssh-reconnect'),
      key: disconnectedSource.key,
    }} />);
    expect(screen.queryByText('before-disconnect.txt')).toBeNull();
    expect(screen.getByText('Loading…')).toHaveAttribute('role', 'status');

    resolveReconnected(remoteListing('/home/janet', [{
      ...file('after-reconnect.txt'), path: '/home/janet/after-reconnect.txt',
    }]));
    expect(await screen.findByText('after-reconnect.txt')).toBeInTheDocument();
    view.unmount();
  });

  it('retries a remote listing failure without falling back to local files', async () => {
    sshListDir
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(remoteListing('/home/janet', [{
        ...file('recovered.txt'), path: '/home/janet/recovered.txt',
      }]));

    const view = render(<FileExplorer source={sshSource('ssh-retry')} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('recovered.txt')).toBeInTheDocument();
    expect(sshListDir).toHaveBeenCalledTimes(2);
    expect(fsListDir).not.toHaveBeenCalled();
    view.unmount();
  });

  it('passes the hidden-file preference to remote listings', async () => {
    sshListDir
      .mockResolvedValueOnce(remoteListing('/home/janet', [{
        ...file('visible.txt'), path: '/home/janet/visible.txt',
      }]))
      .mockResolvedValueOnce(remoteListing('/home/janet', [{
        ...file('.secret'), path: '/home/janet/.secret',
      }]));

    const view = render(<FileExplorer source={sshSource('ssh-hidden')} />);
    expect(await screen.findByText('visible.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show hidden files' }));

    expect(await screen.findByText('.secret')).toBeInTheDocument();
    expect(sshListDir).toHaveBeenLastCalledWith({
      sessionId: 'ssh-hidden',
      remotePath: '/home/janet',
      showHidden: true,
    });
    view.unmount();
  });
});
