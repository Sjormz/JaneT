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

  return import('../main/ssh');
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
});
