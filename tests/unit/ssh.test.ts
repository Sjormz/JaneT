import { describe, it, expect, vi, beforeEach } from 'vitest';

class MiniEmitter {
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, cb: (...args: any[]) => void) {
    const list = this.listeners.get(event) || [];
    list.push(cb);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: any[]) {
    for (const cb of this.listeners.get(event) || []) {
      cb(...args);
    }
  }
}

class MockShellStream extends MiniEmitter {
  stderr = new MiniEmitter();
  write = vi.fn();
  setWindow = vi.fn();
  close = vi.fn();
}

const mocks = {
  shellMock: vi.fn(),
  connectMock: vi.fn(),
  lastClient: null as MiniEmitter | null,
};

async function loadSSHManager() {
  vi.resetModules();
  vi.doMock('ssh2', () => {
    class MockClient extends MiniEmitter {
      shell = mocks.shellMock;
      connect = mocks.connectMock;
      sftp = vi.fn();
      end = vi.fn();

      constructor() {
        super();
        mocks.lastClient = this;
      }
    }

    return { Client: MockClient };
  });

  return import('../../src/main/ssh');
}

beforeEach(() => {
  mocks.shellMock.mockReset();
  mocks.connectMock.mockReset();
  mocks.lastClient = null;
  vi.resetModules();
});

describe('SSHManager', () => {
  it('uses the local OS username at the ssh2 boundary when the UI omits username', async () => {
    mocks.connectMock.mockImplementation(() => {
      queueMicrotask(() => mocks.lastClient?.emit('ready'));
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('host-only', {
      host: 'terminal.shop',
      port: 22,
      username: undefined,
      auth: 'password',
    });

    expect(mocks.connectMock).toHaveBeenCalledWith(expect.objectContaining({
      host: 'terminal.shop',
      port: 22,
      username: expect.any(String),
      tryKeyboard: true,
    }));
    expect(mocks.connectMock.mock.calls[0][0].username.length).toBeGreaterThan(0);
  });

  it('buffers early shell output until the renderer registers onData', async () => {
    mocks.shellMock.mockImplementation((opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      const stream = new MockShellStream();
      cb(undefined, stream);
      stream.emit('data', Buffer.from('early output'));
    });

    mocks.connectMock.mockImplementation(() => {
      queueMicrotask(() => mocks.lastClient?.emit('ready'));
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-1', {
      host: 'example.com',
      port: 22,
      username: 'alice',
      auth: 'password',
      password: 'secret',
    });

    const handle = manager.createShell('session-1', 'term-1', { cols: 80, rows: 24 });
    const received: string[] = [];
    handle.onData((chunk) => received.push(chunk));

    await handle.ready;

    expect(mocks.shellMock).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 80, rows: 24, term: 'xterm-256color' }),
      expect.any(Function),
    );
    expect(received).toEqual(['early output']);
  });

  it('queues writes until the SSH shell stream exists', async () => {
    type ShellCallback = Parameters<typeof mocks.shellMock.mockImplementation>[0] extends (
      opts: unknown,
      cb: infer Callback,
    ) => unknown
      ? Callback
      : never;

    let shellCallback: ShellCallback | null = null;
    mocks.shellMock.mockImplementation((opts: unknown, cb: ShellCallback) => {
      shellCallback = cb;
    });

    mocks.connectMock.mockImplementation(() => {
      queueMicrotask(() => mocks.lastClient?.emit('ready'));
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-2', {
      host: 'example.com',
      port: 22,
      username: 'alice',
      auth: 'password',
      password: 'secret',
    });

    const handle = manager.createShell('session-2', 'term-2', { cols: 100, rows: 30 });
    manager.writeShell('term-2', 'ls -la\n');

    const stream = new MockShellStream();
    shellCallback?.(undefined, stream);
    await handle.ready;

    expect(stream.write).toHaveBeenCalledWith('ls -la\n');
  });

  it('drops queued input and the in-flight handle when opening a shell fails', async () => {
    let shellCallback: (err: Error) => void = () => {};
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error) => void) => {
      shellCallback = cb;
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-failed-shell', {
      host: 'example.com',
      port: 22,
      username: 'alice',
      auth: 'password',
    });

    const handle = manager.createShell('session-failed-shell', 'term-failed-shell', { cols: 80, rows: 24 });
    manager.writeShell('term-failed-shell', 'stale input\n', 'session-failed-shell');
    shellCallback(new Error('channel rejected'));

    await expect(handle.ready).rejects.toThrow('channel rejected');
    const connection = (manager as any).connections.get('session-failed-shell');
    expect(connection.shellHandles.has('term-failed-shell')).toBe(false);
    expect(connection.pendingWrites.has('term-failed-shell')).toBe(false);

    manager.writeShell('term-failed-shell', 'more stale input\n', 'session-failed-shell');
    expect(connection.pendingWrites.has('term-failed-shell')).toBe(false);
  });

  it('writes binary terminal input as a Buffer to the live SSH channel', async () => {
    let stream: MockShellStream | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      stream = new MockShellStream();
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-binary', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    await manager.createShell('session-binary', 'term-binary', { cols: 80, rows: 24 }).ready;
    manager.writeShellBinary('term-binary', '\xff\x00', 'session-binary');

    expect(stream?.write).toHaveBeenCalledWith(Buffer.from('\xff\x00', 'binary'));
  });

  it('routes terminal writes only to their owning SSH connection', async () => {
    const streams: MockShellStream[] = [];
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      const stream = new MockShellStream();
      streams.push(stream);
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-a', { host: 'a.example.com', port: 22, username: 'alice', auth: 'password' });
    await manager.connect('session-b', { host: 'b.example.com', port: 22, username: 'bob', auth: 'password' });
    await manager.createShell('session-a', 'term-a', { cols: 80, rows: 24 }).ready;

    manager.writeShell('term-a', 'echo safe\n', 'session-a');
    manager.writeShellBinary('term-a', '\xff\x00', 'session-a');

    expect(streams[0].write).toHaveBeenNthCalledWith(1, 'echo safe\n');
    expect(streams[0].write).toHaveBeenNthCalledWith(2, Buffer.from('\xff\x00', 'binary'));
    const unrelated = (manager as any).connections.get('session-b');
    expect(unrelated.pendingWrites.has('term-a')).toBe(false);

    streams[0].emit('close');
    manager.writeShell('term-a', 'stale input\n', 'session-a');
    const closed = (manager as any).connections.get('session-a');
    expect(closed.pendingWrites.has('term-a')).toBe(false);
  });

  it('reuses the same shell (and does not open a second SSH channel) when createShell is called twice for one termId — StrictMode double-mount', async () => {
    mocks.shellMock.mockImplementation((opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      const stream = new MockShellStream();
      cb(undefined, stream);
    });

    mocks.connectMock.mockImplementation(() => {
      queueMicrotask(() => mocks.lastClient?.emit('ready'));
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-3', {
      host: 'example.com',
      port: 22,
      username: 'alice',
      auth: 'password',
      password: 'secret',
    });

    // Simulates React 18 StrictMode's mount -> cleanup -> mount, which
    // calls the IPC handler (and therefore createShell()) twice for the
    // same termId before the first call's caller has any chance to react.
    const first = manager.createShell('session-3', 'term-3', { cols: 80, rows: 24 });
    const second = manager.createShell('session-3', 'term-3', { cols: 80, rows: 24 });

    expect(mocks.shellMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('only ever dispatches to the most recently registered onData callback, even across repeat createShell calls', async () => {
    let stream: MockShellStream | null = null;
    mocks.shellMock.mockImplementation((opts: unknown, cb: (err: Error | undefined, s?: MockShellStream) => void) => {
      stream = new MockShellStream();
      cb(undefined, stream);
    });

    mocks.connectMock.mockImplementation(() => {
      queueMicrotask(() => mocks.lastClient?.emit('ready'));
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('session-4', {
      host: 'example.com',
      port: 22,
      username: 'alice',
      auth: 'password',
      password: 'secret',
    });

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const handleA = manager.createShell('session-4', 'term-4', { cols: 80, rows: 24 });
    handleA.onData((d) => receivedA.push(d));
    const handleB = manager.createShell('session-4', 'term-4', { cols: 80, rows: 24 });
    handleB.onData((d) => receivedB.push(d));

    await handleB.ready;
    stream!.emit('data', Buffer.from('PS C:\\Users\\pckpr> '));

    // Only the most recently registered forwarder receives data — output
    // is never dispatched to two callbacks for the one termId at once.
    expect(receivedA).toEqual([]);
    expect(receivedB).toEqual(['PS C:\\Users\\pckpr> ']);
  });

  it('trusts the first host key and rejects a changed key on the next connection', async () => {
    const trusted = new Map<string, string>();
    const store = {
      lookup: vi.fn((host: string, port: number) => trusted.get(`${host.toLowerCase()}:${port}`)),
      remember: vi.fn((host: string, port: number, fingerprint: string) => {
        trusted.set(`${host.toLowerCase()}:${port}`, fingerprint);
      }),
    };
    const confirmHostKey = vi.fn(async () => true);
    let presentedKey = Buffer.from('host-key-one');
    mocks.connectMock.mockImplementation((options: any) => {
      options.hostVerifier(presentedKey, (accepted: boolean) => {
        queueMicrotask(() => {
          if (accepted) mocks.lastClient?.emit('ready');
          else mocks.lastClient?.emit('error', new Error('Host key verification failed'));
        });
      });
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager(store, confirmHostKey);
    await manager.connect('tofu-1', { host: 'Box.Local', port: 22, username: 'alice', auth: 'password' });

    expect(mocks.connectMock.mock.calls[0][0]).toMatchObject({
      readyTimeout: 5 * 60 * 1000,
    });
    expect(mocks.connectMock.mock.calls[0][0]).not.toHaveProperty('hostHash');
    expect(confirmHostKey).toHaveBeenCalledWith(
      'Box.Local',
      22,
      'SHA256:5xl3W1XDEU1z54wFFu6itvJjpVYaYTXCR7tYHYY9/P8',
    );
    expect(store.remember).toHaveBeenCalledWith(
      'Box.Local',
      22,
      'SHA256:5xl3W1XDEU1z54wFFu6itvJjpVYaYTXCR7tYHYY9/P8',
    );
    await manager.disconnect('tofu-1');

    presentedKey = Buffer.from('host-key-two');
    await expect(manager.connect('tofu-2', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    })).rejects.toThrow(/host key changed for Box\.Local:22/i);
    expect(store.remember).toHaveBeenCalledTimes(1);
    expect(confirmHostKey).toHaveBeenCalledTimes(1);
  });

  it('migrates a matching legacy hex host fingerprint to standard OpenSSH form', async () => {
    const legacyFingerprint = 'sha256:e719775b55c3114d73e78c0516eea2b6f263a5561a6135c247bb581d863dfcff';
    const standardFingerprint = 'SHA256:5xl3W1XDEU1z54wFFu6itvJjpVYaYTXCR7tYHYY9/P8';
    let trusted = legacyFingerprint;
    const store = {
      lookup: vi.fn(() => trusted),
      remember: vi.fn(),
      migrate: vi.fn((_host: string, _port: number, expected: string, fingerprint: string) => {
        if (trusted !== expected) throw new Error('fingerprint changed during migration');
        trusted = fingerprint;
      }),
    };
    const confirmHostKey = vi.fn(async () => true);
    mocks.connectMock.mockImplementation((options: any) => {
      options.hostVerifier(Buffer.from('host-key-one'), (accepted: boolean) => {
        queueMicrotask(() => {
          if (accepted) mocks.lastClient?.emit('ready');
          else mocks.lastClient?.emit('error', new Error('Host key verification failed'));
        });
      });
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager(store, confirmHostKey);
    await manager.connect('legacy-host-key', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    });

    expect(store.migrate).toHaveBeenCalledWith(
      'Box.Local',
      22,
      legacyFingerprint,
      standardFingerprint,
    );
    expect(trusted).toBe(standardFingerprint);
    expect(store.remember).not.toHaveBeenCalled();
    expect(confirmHostKey).not.toHaveBeenCalled();
  });

  it('rejects a first-seen host key when the user cancels trust', async () => {
    const store = {
      lookup: vi.fn(() => undefined),
      remember: vi.fn(),
    };
    const confirmHostKey = vi.fn(async () => false);
    mocks.connectMock.mockImplementation((options: any) => {
      options.hostVerifier(Buffer.from('cancel-key'), (accepted: boolean) => {
        queueMicrotask(() => {
          if (accepted) mocks.lastClient?.emit('ready');
          else mocks.lastClient?.emit('error', new Error('Host key verification failed'));
        });
      });
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager(store, confirmHostKey);

    await expect(manager.connect('tofu-cancelled', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    })).rejects.toThrow(/host key was not trusted for Box\.Local:22/i);
    expect(confirmHostKey).toHaveBeenCalledWith(
      'Box.Local',
      22,
      'SHA256:Qu6A6J1x8YTAuWrF+X/STyQdOougL7c87m57D9iVkRY',
    );
    expect(store.remember).not.toHaveBeenCalled();
  });

  it('does not remember a late approval after the SSH handshake times out', async () => {
    const store = {
      lookup: vi.fn(() => undefined),
      remember: vi.fn(),
    };
    let approve!: (approved: boolean) => void;
    const confirmHostKey = vi.fn(() => new Promise<boolean>((resolve) => {
      approve = resolve;
    }));
    const decision = vi.fn();
    mocks.connectMock.mockImplementation((options: any) => {
      options.hostVerifier(Buffer.from('stale-key'), decision);
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager(store, confirmHostKey);
    const connecting = manager.connect('tofu-timeout', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    });
    const rejection = expect(connecting).rejects.toThrow('Timed out while waiting for handshake');

    mocks.lastClient?.emit('error', new Error('Timed out while waiting for handshake'));
    await rejection;
    approve(true);
    await Promise.resolve();

    expect(store.remember).not.toHaveBeenCalled();
    expect(decision).not.toHaveBeenCalled();
  });

  it('does not remember a late approval after the pending connection is cancelled', async () => {
    const store = {
      lookup: vi.fn(() => undefined),
      remember: vi.fn(),
    };
    let approve!: (approved: boolean) => void;
    const confirmHostKey = vi.fn(() => new Promise<boolean>((resolve) => {
      approve = resolve;
    }));
    const decision = vi.fn();
    mocks.connectMock.mockImplementation((options: any) => {
      options.hostVerifier(Buffer.from('stale-key'), decision);
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager(store, confirmHostKey);
    const connecting = manager.connect('tofu-cancelled-late', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    });
    const rejection = expect(connecting).rejects.toThrow(/connection tofu-cancelled-late was cancelled/i);

    await manager.disconnect('tofu-cancelled-late');
    await rejection;
    approve(true);
    await Promise.resolve();

    expect(store.remember).not.toHaveBeenCalled();
    expect(decision).not.toHaveBeenCalled();
  });

  it('does not apply a stale approval to a replacement attempt with the same session id', async () => {
    const store = {
      lookup: vi.fn(() => undefined),
      remember: vi.fn(),
    };
    const approvals: Array<(approved: boolean) => void> = [];
    const confirmHostKey = vi.fn(() => new Promise<boolean>((resolve) => {
      approvals.push(resolve);
    }));
    const decisions: ReturnType<typeof vi.fn>[] = [];
    mocks.connectMock.mockImplementation((options: any) => {
      const decision = vi.fn();
      decisions.push(decision);
      options.hostVerifier(Buffer.from('stale-key'), decision);
    });

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager(store, confirmHostKey);
    const first = manager.connect('reused-session', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    });
    const firstRejection = expect(first).rejects.toThrow(/connection reused-session was cancelled/i);
    await manager.disconnect('reused-session');
    await firstRejection;

    const replacement = manager.connect('reused-session', {
      host: 'Box.Local', port: 22, username: 'alice', auth: 'password',
    });
    approvals[0](true);
    await Promise.resolve();

    expect(store.remember).not.toHaveBeenCalled();
    expect(decisions[0]).not.toHaveBeenCalled();
    expect(confirmHostKey).toHaveBeenCalledTimes(2);

    const replacementRejection = expect(replacement).rejects.toThrow(/connection reused-session was cancelled/i);
    await manager.disconnect('reused-session');
    await replacementRejection;
    approvals[1](true);
    await Promise.resolve();
    expect(store.remember).not.toHaveBeenCalled();
  });

  it('coalesces duplicate connection attempts and removes active connections on close', async () => {
    mocks.connectMock.mockImplementation(() => {});
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();

    const first = manager.connect('same-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    const second = manager.connect('same-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    expect(second).toBe(first);
    expect(mocks.connectMock).toHaveBeenCalledTimes(1);

    mocks.lastClient?.emit('ready');
    await Promise.all([first, second]);
    await manager.connect('same-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    expect(mocks.connectMock).toHaveBeenCalledTimes(1);
    expect(manager.listConnections()).toHaveLength(1);

    mocks.lastClient?.emit('close');
    expect(manager.listConnections()).toHaveLength(0);
  });

  it('decodes UTF-8 incrementally when a code point spans SSH data chunks', async () => {
    let stream: MockShellStream | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      stream = new MockShellStream();
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('utf8-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    const handle = manager.createShell('utf8-session', 'utf8-term', { cols: 80, rows: 24 });
    const received: string[] = [];
    handle.onData((data) => received.push(data));
    await handle.ready;

    const encoded = Buffer.from('€');
    stream?.emit('data', encoded.subarray(0, 1));
    expect(received).toEqual([]);
    stream?.emit('data', encoded.subarray(1));
    expect(received).toEqual(['€']);
  });

  it('destroys a live shell by session and drops later writes', async () => {
    let stream: MockShellStream | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      stream = new MockShellStream();
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('destroy-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    await manager.createShell('destroy-session', 'destroy-term', { cols: 80, rows: 24 }).ready;

    expect(manager.destroyShell('destroy-term', 'destroy-session')).toBe(true);
    expect(stream?.close).toHaveBeenCalledTimes(1);
    manager.writeShell('destroy-term', 'stale input', 'destroy-session');
    expect(stream?.write).not.toHaveBeenCalled();
    expect(manager.destroyShell('destroy-term', 'destroy-session')).toBe(false);
  });

  it('returns cloneable boolean directory metadata from SFTP listings', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('sftp-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const sftp = {
      end: vi.fn(),
      readdir: vi.fn((_remotePath: string, callback: (error: Error | undefined, entries?: any[]) => void) => {
        callback(undefined, [
          {
            filename: 'src',
            attrs: {
              isDirectory: () => true,
              isSymbolicLink: () => false,
              size: 0,
              mode: 0o755,
              mtime: 1,
            },
          },
          {
            filename: 'README.md',
            attrs: {
              isDirectory: () => false,
              isSymbolicLink: () => false,
              size: 42,
              mode: 0o644,
              mtime: 2,
            },
          },
        ]);
      }),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
      callback(undefined, sftp);
    });

    const entries = await manager.listDir('sftp-session', '/repo');

    expect(entries.map(({ name, isDirectory }) => ({ name, isDirectory }))).toEqual([
      { name: 'src', isDirectory: true },
      { name: 'README.md', isDirectory: false },
    ]);
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });
});
