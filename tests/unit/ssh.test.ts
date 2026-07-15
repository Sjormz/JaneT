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
  it('dispatches one compiled startup expression after the SSH shell is ready', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const first = manager.createShell(
      'startup-session', 'startup-term', { cols: 80, rows: 24 },
      ['hermes doctor', 'hermes --tui'], 'posix',
    );
    const second = manager.createShell(
      'startup-session', 'startup-term', { cols: 80, rows: 24 },
      ['hermes doctor', 'hermes --tui'], 'posix',
    );
    await Promise.all([first.ready, second.ready]);

    expect(mocks.shellMock).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledTimes(1);
    expect(stream.write).toHaveBeenCalledWith(
      "eval 'hermes doctor' && eval 'hermes --tui'\r",
    );
  });

  it('cancels pending startup when the user types before the SSH channel opens', async () => {
    const stream = new MockShellStream();
    let openShell: ((err: Error | undefined, stream?: MockShellStream) => void) | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: typeof openShell) => {
      openShell = cb;
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-manual-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell(
      'startup-manual-session', 'startup-manual-term', { cols: 80, rows: 24 }, ['hermes --tui'], 'posix',
    );

    manager.writeShell('startup-manual-term', 'manual input', 'startup-manual-session');
    openShell?.(undefined, stream);
    await handle.ready;

    expect(stream.write.mock.calls).toEqual([['manual input']]);
  });

  it('keeps pending startup when an automatic terminal reply arrives first', async () => {
    const stream = new MockShellStream();
    let openShell: ((err: Error | undefined, stream?: MockShellStream) => void) | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: typeof openShell) => {
      openShell = cb;
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-reply-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell(
      'startup-reply-session', 'startup-reply-term', { cols: 80, rows: 24 }, ['hermes --tui'], 'posix',
    );

    manager.writeShell('startup-reply-term', '\x1b[1;1R', 'startup-reply-session', false);
    openShell?.(undefined, stream);
    await handle.ready;

    expect(stream.write.mock.calls).toEqual([
      ["eval 'hermes --tui'\r"],
      ['\x1b[1;1R'],
    ]);
  });

  it('does not replay startup commands when a shell channel is recreated for the same pane', async () => {
    const streams = [new MockShellStream(), new MockShellStream()];
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      cb(undefined, streams[mocks.shellMock.mock.calls.length - 1]);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-retry-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    await manager.createShell(
      'startup-retry-session', 'startup-retry-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;
    streams[0].emit('close');
    await manager.createShell(
      'startup-retry-session', 'startup-retry-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;

    expect(streams[0].write).toHaveBeenCalledWith("eval 'first'\r");
    expect(streams[1].write).not.toHaveBeenCalled();
  });

  it('keeps exact-once state when a stale session tries to destroy the pane', async () => {
    const streams = [new MockShellStream(), new MockShellStream()];
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      cb(undefined, streams[mocks.shellMock.mock.calls.length - 1]);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-owned-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    await manager.createShell(
      'startup-owned-session', 'startup-owned-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;
    expect(manager.destroyShell('startup-owned-term', 'stale-session')).toBe(false);

    streams[0].emit('close');
    await manager.createShell(
      'startup-owned-session', 'startup-owned-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;

    expect(streams[0].write).toHaveBeenCalledWith("eval 'first'\r");
    expect(streams[1].write).not.toHaveBeenCalled();
  });

  it('does not replay startup commands after the SSH transport reconnects', async () => {
    const streams = [new MockShellStream(), new MockShellStream()];
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      cb(undefined, streams[mocks.shellMock.mock.calls.length - 1]);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-transport-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell(
      'startup-transport-session', 'startup-transport-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;

    mocks.lastClient?.emit('close');
    await manager.connect('startup-transport-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell(
      'startup-transport-session', 'startup-transport-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;

    expect(streams[0].write).toHaveBeenCalledWith("eval 'first'\r");
    expect(streams[1].write).not.toHaveBeenCalled();
  });

  it('allows startup commands again after explicit pane destruction', async () => {
    const streams = [new MockShellStream(), new MockShellStream()];
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      cb(undefined, streams[mocks.shellMock.mock.calls.length - 1]);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-destroy-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    await manager.createShell(
      'startup-destroy-session', 'startup-destroy-term', { cols: 80, rows: 24 }, ['first'], 'posix',
    ).ready;
    manager.destroyShell('startup-destroy-term', 'startup-destroy-session');
    await manager.createShell(
      'startup-destroy-session', 'startup-destroy-term', { cols: 80, rows: 24 }, ['second'], 'posix',
    ).ready;

    expect(streams[0].write).toHaveBeenCalledWith("eval 'first'\r");
    expect(streams[1].write).toHaveBeenCalledWith("eval 'second'\r");
  });

  it('does not execute SSH startup commands without an explicit supported dialect', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, stream?: MockShellStream) => void) => {
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('startup-no-dialect', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell(
      'startup-no-dialect', 'startup-no-dialect-term', { cols: 80, rows: 24 }, ['never-run'],
    ).ready;

    expect(stream.write).not.toHaveBeenCalled();
  });

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

  it('reports an unexpected active-client close exactly once, but ignores explicit and stale closes', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const onConnectionClosed = vi.fn();
    const manager = new SSHManager(undefined, undefined, onConnectionClosed);

    await manager.connect('unexpected-session', {
      host: 'unexpected.example.com', port: 22, username: 'alice', auth: 'password',
    });
    const unexpectedlyClosedClient = mocks.lastClient;
    unexpectedlyClosedClient?.emit('error', new Error('transport reset'));
    unexpectedlyClosedClient?.emit('end');
    unexpectedlyClosedClient?.emit('close');

    expect(onConnectionClosed).toHaveBeenCalledTimes(1);
    expect(onConnectionClosed).toHaveBeenCalledWith({
      id: 'unexpected-session',
      reason: 'transport reset',
    });

    await manager.connect('reused-session', {
      host: 'old.example.com', port: 22, username: 'alice', auth: 'password',
    });
    const explicitlyClosedClient = mocks.lastClient;
    (explicitlyClosedClient as any).end.mockImplementation(() => explicitlyClosedClient?.emit('close'));
    await manager.disconnect('reused-session');
    explicitlyClosedClient?.emit('close');

    await manager.connect('reused-session', {
      host: 'new.example.com', port: 22, username: 'alice', auth: 'password',
    });
    explicitlyClosedClient?.emit('error', new Error('stale transport reset'));
    explicitlyClosedClient?.emit('end');

    expect(onConnectionClosed).toHaveBeenCalledTimes(1);
    expect(manager.listConnections()).toEqual([
      expect.objectContaining({ id: 'reused-session', host: 'new.example.com' }),
    ]);
  });

  it('lists only SSH connections with pending or live shells', async () => {
    let pendingShellCallback: ((err: Error | undefined, channel?: MockShellStream) => void) | undefined;
    const liveStream = new MockShellStream();
    mocks.shellMock.mockImplementationOnce((_opts: unknown, cb: typeof pendingShellCallback) => {
      pendingShellCallback = cb;
    });
    mocks.shellMock.mockImplementationOnce((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      cb(undefined, liveStream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('running-session', {
      host: 'jobs.example.com', port: 2202, username: 'worker', auth: 'password',
    });

    expect(manager.listRunningSessions()).toEqual([]);

    const pending = manager.createShell('running-session', 'pending-term', { cols: 80, rows: 24 });
    void pending.ready.catch(() => {});
    expect(manager.listRunningSessions()).toEqual([{
      id: 'running-session',
      host: 'jobs.example.com',
      port: 2202,
      username: 'worker',
      shellCount: 1,
    }]);

    await manager.createShell('running-session', 'live-term', { cols: 80, rows: 24 }).ready;
    expect(manager.listRunningSessions()).toEqual([{
      id: 'running-session',
      host: 'jobs.example.com',
      port: 2202,
      username: 'worker',
      shellCount: 2,
    }]);

    pendingShellCallback?.(new Error('test cleanup'));
    await expect(pending.ready).rejects.toThrow('test cleanup');
  });

  it('removes an SSH session from the running list after its last shell is destroyed', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('destroy-running-session', {
      host: 'destroy.example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell('destroy-running-session', 'destroy-running-term', { cols: 80, rows: 24 }).ready;

    expect(manager.listRunningSessions()).toHaveLength(1);
    expect(manager.destroyShell('destroy-running-term', 'destroy-running-session')).toBe(true);
    expect(manager.listRunningSessions()).toEqual([]);
  });

  it('removes unexpectedly closed SSH connections from the running list', async () => {
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      cb(undefined, new MockShellStream());
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('unexpected-running-session', {
      host: 'unstable.example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell('unexpected-running-session', 'unexpected-running-term', { cols: 80, rows: 24 }).ready;
    expect(manager.listRunningSessions()).toHaveLength(1);

    mocks.lastClient?.emit('close');

    expect(manager.listRunningSessions()).toEqual([]);
  });

  it('empties the running SSH session list during manager cleanup', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('cleanup-running-session', {
      host: 'cleanup.example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell('cleanup-running-session', 'cleanup-running-term', { cols: 80, rows: 24 }).ready;
    expect(manager.listRunningSessions()).toHaveLength(1);

    manager.cleanup();

    expect(manager.listRunningSessions()).toEqual([]);
    expect(stream.close).toHaveBeenCalledTimes(1);
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

  it('resolves and lists the remote home directory on one SFTP channel', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('home-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const sftp = {
      end: vi.fn(),
      realpath: vi.fn((_remotePath: string, callback: (error: Error | undefined, path?: string) => void) => {
        callback(undefined, '/home/alice');
      }),
      readdir: vi.fn((_remotePath: string, callback: (error: Error | undefined, entries?: any[]) => void) => {
        callback(undefined, []);
      }),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
      callback(undefined, sftp);
    });

    await expect(manager.listDir('home-session')).resolves.toEqual({
      resolvedPath: '/home/alice',
      entries: [],
    });
    expect(sftp.realpath).toHaveBeenCalledWith('.', expect.any(Function));
    expect(sftp.readdir).toHaveBeenCalledWith('/home/alice', expect.any(Function));
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });

  it('returns filtered, sorted, cloneable directory metadata from SFTP listings', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('sftp-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const sftp = {
      end: vi.fn(),
      realpath: vi.fn((_remotePath: string, callback: (error: Error | undefined, path?: string) => void) => {
        callback(undefined, '/repo/');
      }),
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
          {
            filename: '.env',
            attrs: {
              isDirectory: () => false,
              isSymbolicLink: () => false,
              size: 8,
              mode: 0o600,
              mtime: 3,
            },
          },
        ]);
      }),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
      callback(undefined, sftp);
    });

    const listing = await manager.listDir('sftp-session', '/repo', false);

    expect(listing.resolvedPath).toBe('/repo/');
    expect(listing.entries.map(({ name, isDirectory }) => ({ name, isDirectory }))).toEqual([
      { name: 'src', isDirectory: true },
      { name: 'README.md', isDirectory: false },
    ]);
    expect(listing.entries[0].path).toBe('/repo/src');

    const withHidden = await manager.listDir('sftp-session', '/repo', true);
    expect(withHidden.entries.map(({ name }) => name)).toEqual(['src', '.env', 'README.md']);
    expect(sftp.end).toHaveBeenCalledTimes(2);
  });

  it('follows only symlink targets sequentially so directory links are navigable', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('symlink-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    let activeStats = 0;
    let maxActiveStats = 0;
    const attrs = (isDirectory: boolean, isSymlink: boolean) => ({
      isDirectory: () => isDirectory,
      isSymbolicLink: () => isSymlink,
      size: 0,
      mode: 0o755,
      mtime: 1,
    });
    const sftp = {
      end: vi.fn(),
      realpath: vi.fn((_path: string, callback: (error: Error | undefined, path?: string) => void) => {
        callback(undefined, '/workspace');
      }),
      readdir: vi.fn((_path: string, callback: (error: Error | undefined, entries?: any[]) => void) => {
        callback(undefined, [
          { filename: 'regular-dir', attrs: attrs(true, false) },
          { filename: 'linked-dir', attrs: attrs(false, true) },
          { filename: 'linked-file', attrs: attrs(false, true) },
          { filename: 'broken-link', attrs: attrs(false, true) },
          { filename: 'throwing-link', attrs: attrs(false, true) },
          { filename: 'regular-file', attrs: attrs(false, false) },
        ]);
      }),
      stat: vi.fn((path: string, callback: (error?: Error, targetAttrs?: any) => void) => {
        if (path.endsWith('/throwing-link')) throw new Error('stat unavailable');
        activeStats += 1;
        maxActiveStats = Math.max(maxActiveStats, activeStats);
        queueMicrotask(() => {
          activeStats -= 1;
          if (path.endsWith('/broken-link')) {
            callback(new Error('dangling symlink'));
          } else {
            callback(undefined, attrs(path.endsWith('/linked-dir'), false));
          }
        });
      }),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
      callback(undefined, sftp);
    });

    const listing = await manager.listDir('symlink-session', '/workspace');

    expect(sftp.stat.mock.calls.map(([path]) => path)).toEqual([
      '/workspace/linked-dir',
      '/workspace/linked-file',
      '/workspace/broken-link',
      '/workspace/throwing-link',
    ]);
    expect(maxActiveStats).toBe(1);
    expect(listing.entries.map(({ name, isDirectory, isSymlink }) => ({
      name, isDirectory, isSymlink,
    }))).toEqual([
      { name: 'linked-dir', isDirectory: true, isSymlink: true },
      { name: 'regular-dir', isDirectory: true, isSymlink: false },
      { name: 'broken-link', isDirectory: false, isSymlink: true },
      { name: 'linked-file', isDirectory: false, isSymlink: true },
      { name: 'regular-file', isDirectory: false, isSymlink: false },
      { name: 'throwing-link', isDirectory: false, isSymlink: true },
    ]);
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });

  it('closes the SFTP channel when a directory read fails', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('failed-sftp-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const sftp = {
      end: vi.fn(),
      realpath: vi.fn((_remotePath: string, callback: (error: Error | undefined, path?: string) => void) => {
        callback(undefined, '/root');
      }),
      readdir: vi.fn((_remotePath: string, callback: (error: Error | undefined) => void) => {
        callback(new Error('permission denied'));
      }),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
      callback(undefined, sftp);
    });

    await expect(manager.listDir('failed-sftp-session', '/root'))
      .rejects.toThrow('permission denied');
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid remote paths before opening SFTP', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('invalid-path-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    await expect(manager.listDir('invalid-path-session', 'bad\0path'))
      .rejects.toThrow(/NUL/i);
    expect((mocks.lastClient as any).sftp).not.toHaveBeenCalled();
  });

  it('surfaces an SFTP subsystem failure without closing the SSH shell connection', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('no-sftp-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error) => void) => {
      callback(new Error('subsystem unavailable'));
    });

    await expect(manager.listDir('no-sftp-session'))
      .rejects.toThrow('subsystem unavailable');
    expect((mocks.lastClient as any).end).not.toHaveBeenCalled();
    expect(manager.listConnections()).toEqual([expect.objectContaining({ id: 'no-sftp-session' })]);
  });

  it('settles and cleans up immediately when opening SFTP throws synchronously', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('throwing-sftp-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const sftp = {
      end: vi.fn(),
      realpath: vi.fn(() => {}),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
      callback(undefined, sftp);
      throw new Error('sftp open threw');
    });

    await expect(manager.listDir('throwing-sftp-session'))
      .rejects.toThrow('sftp open threw');
    expect(sftp.end).toHaveBeenCalledTimes(1);
    expect((manager as any).connections.get('throwing-sftp-session').sftpOperations.size).toBe(0);
  });

  it('does not continue resolving symlinks after an SFTP listing times out', async () => {
    vi.useFakeTimers();
    try {
      mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

      const { SSHManager } = await loadSSHManager();
      const manager = new SSHManager();
      const connected = manager.connect('late-stat-session', {
        host: 'example.com', port: 22, username: 'alice', auth: 'password',
      });
      await vi.runAllTicks();
      await connected;

      const symlinkAttrs = {
        isDirectory: () => false,
        isSymbolicLink: () => true,
        size: 0,
        mode: 0o777,
        mtime: 1,
      };
      let finishFirstStat!: (error?: Error, attrs?: any) => void;
      const sftp = {
        end: vi.fn(),
        realpath: vi.fn((_path: string, callback: (error: Error | undefined, path?: string) => void) => {
          callback(undefined, '/workspace');
        }),
        readdir: vi.fn((_path: string, callback: (error: Error | undefined, entries?: any[]) => void) => {
          callback(undefined, [
            { filename: 'first-link', attrs: symlinkAttrs },
            { filename: 'second-link', attrs: symlinkAttrs },
          ]);
        }),
        stat: vi.fn((_path: string, callback: typeof finishFirstStat) => {
          finishFirstStat = callback;
        }),
      };
      (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof sftp) => void) => {
        callback(undefined, sftp);
      });

      const listing = manager.listDir('late-stat-session', '/workspace');
      const timedOut = expect(listing).rejects.toThrow(/timed out/i);
      expect(sftp.stat).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      await timedOut;
      expect(sftp.end).toHaveBeenCalledTimes(1);

      finishFirstStat(undefined, { isDirectory: () => true });
      await vi.runAllTicks();
      expect(sftp.stat).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight listing before the session id is reused', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('reused-sftp-session', {
      host: 'old.example.com', port: 22, username: 'alice', auth: 'password',
    });

    let finishRealpath!: (error: Error | undefined, path?: string) => void;
    const oldSftp = {
      end: vi.fn(),
      realpath: vi.fn((_path: string, callback: typeof finishRealpath) => {
        finishRealpath = callback;
      }),
      readdir: vi.fn((_path: string, callback: (error: Error | undefined, entries?: any[]) => void) => {
        callback(undefined, []);
      }),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: (error: Error | undefined, client?: typeof oldSftp) => void) => {
      callback(undefined, oldSftp);
    });

    const staleListing = manager.listDir('reused-sftp-session');
    const staleRejection = expect(staleListing).rejects.toThrow(/connection reused-sftp-session was closed/i);
    await manager.disconnect('reused-sftp-session');
    await manager.connect('reused-sftp-session', {
      host: 'new.example.com', port: 22, username: 'alice', auth: 'password',
    });
    finishRealpath(undefined, '/home/alice');

    await staleRejection;
    expect(oldSftp.end).toHaveBeenCalledTimes(1);
  });

  it('times out an SFTP request that never opens a subsystem channel', async () => {
    vi.useFakeTimers();
    try {
      mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

      const { SSHManager } = await loadSSHManager();
      const manager = new SSHManager();
      const connected = manager.connect('hung-sftp-session', {
        host: 'example.com', port: 22, username: 'alice', auth: 'password',
      });
      await vi.runAllTicks();
      await connected;
      (mocks.lastClient as any).sftp.mockImplementation(() => {});

      const listing = manager.listDir('hung-sftp-session');
      const timedOut = expect(listing).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(30_000);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });
});
