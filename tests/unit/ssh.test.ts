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

class MockReadable extends MiniEmitter {
  pause = vi.fn();
  resume = vi.fn();
}

class MockShellStream extends MockReadable {
  stderr = new MockReadable();
  write = vi.fn();
  setWindow = vi.fn();
  close = vi.fn();
}

const mocks = {
  shellMock: vi.fn(),
  connectMock: vi.fn(),
  forwardOutMock: vi.fn(),
  lastClient: null as MiniEmitter | null,
  clients: [] as any[],
};

interface MockRemoteFile {
  bytes: Buffer;
  mtime: number;
  mode: number;
  uid: number;
  gid: number;
}

function remoteAttrs(file: MockRemoteFile) {
  return {
    size: file.bytes.byteLength,
    mtime: file.mtime,
    atime: file.mtime,
    mode: file.mode,
    uid: file.uid,
    gid: file.gid,
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

function createTextFileSftp(initial: Record<string, string | Buffer>) {
  let clock = 10;
  let nextHandle = 1;
  const files = new Map<string, MockRemoteFile>(
    Object.entries(initial).map(([path, content]) => [
      path,
      { bytes: Buffer.from(content), mtime: clock++, mode: 0o100644, uid: 1000, gid: 1000 },
    ]),
  );
  const handles = new Map<string, string>();
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });

  const sftp = {
    end: vi.fn(),
    realpath: vi.fn((remotePath: string, callback: (error?: Error, path?: string) => void) => {
      callback(files.has(remotePath) ? undefined : missing(), files.has(remotePath) ? remotePath : undefined);
    }),
    stat: vi.fn((remotePath: string, callback: (error?: Error, attrs?: ReturnType<typeof remoteAttrs>) => void) => {
      const file = files.get(remotePath);
      callback(file ? undefined : missing(), file ? remoteAttrs(file) : undefined);
    }),
    open: vi.fn((remotePath: string, flags: string, attrsOrCallback: unknown, maybeCallback?: Function) => {
      const callback = (typeof attrsOrCallback === 'function' ? attrsOrCallback : maybeCallback) as Function;
      if (flags === 'r') {
        if (!files.has(remotePath)) {
          callback(missing());
          return;
        }
      } else if (flags === 'wx') {
        if (files.has(remotePath)) {
          callback(Object.assign(new Error('Failure'), { code: 4 }));
          return;
        }
        const mode = typeof attrsOrCallback === 'object' && attrsOrCallback
          ? Number((attrsOrCallback as { mode?: number }).mode) || 0o600
          : 0o600;
        files.set(remotePath, {
          bytes: Buffer.alloc(0),
          mtime: clock++,
          mode: 0o100000 | mode,
          uid: 1000,
          gid: 1000,
        });
      } else {
        callback(new Error(`Unexpected open flags: ${flags}`));
        return;
      }
      const handle = Buffer.from(`handle-${nextHandle++}`);
      handles.set(handle.toString('hex'), remotePath);
      callback(undefined, handle);
    }),
    close: vi.fn((_handle: Buffer, callback: (error?: Error) => void) => callback()),
    fstat: vi.fn((handle: Buffer, callback: (error?: Error, attrs?: ReturnType<typeof remoteAttrs>) => void) => {
      const file = files.get(handles.get(handle.toString('hex')) || '');
      callback(file ? undefined : missing(), file ? remoteAttrs(file) : undefined);
    }),
    fsetstat: vi.fn((
      handle: Buffer,
      attrs: { mode?: number },
      callback: (error?: Error) => void,
    ) => {
      const file = files.get(handles.get(handle.toString('hex')) || '');
      if (!file) {
        callback(missing());
        return;
      }
      if (Number.isSafeInteger(attrs.mode)) {
        file.mode = (file.mode & ~0o7777) | (Number(attrs.mode) & 0o7777);
      }
      callback();
    }),
    read: vi.fn((
      handle: Buffer,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
      callback: (error: Error | undefined, bytesRead: number, buffer: Buffer, position: number) => void,
    ) => {
      const file = files.get(handles.get(handle.toString('hex')) || '');
      if (!file) {
        callback(missing(), 0, buffer, position);
        return;
      }
      const bytesRead = Math.min(length, Math.max(0, file.bytes.byteLength - position));
      file.bytes.copy(buffer, offset, position, position + bytesRead);
      callback(undefined, bytesRead, buffer, position);
    }),
    write: vi.fn((
      handle: Buffer,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
      callback: (error?: Error) => void,
    ) => {
      const path = handles.get(handle.toString('hex')) || '';
      const file = files.get(path);
      if (!file) {
        callback(missing());
        return;
      }
      const next = Buffer.alloc(Math.max(file.bytes.byteLength, position + length));
      file.bytes.copy(next);
      buffer.copy(next, position, offset, offset + length);
      file.bytes = next;
      file.mtime = clock++;
      callback();
    }),
    ext_openssh_rename: vi.fn((sourcePath: string, destinationPath: string, callback: (error?: Error) => void) => {
      const source = files.get(sourcePath);
      if (!source) {
        callback(missing());
        return;
      }
      files.set(destinationPath, source);
      files.delete(sourcePath);
      callback();
    }),
    ext_openssh_fsync: vi.fn((_handle: Buffer, callback: (error?: Error) => void) => callback()),
    unlink: vi.fn((remotePath: string, callback: (error?: Error) => void) => {
      files.delete(remotePath);
      callback();
    }),
  };

  return {
    sftp,
    files,
    setFile(remotePath: string, content: string | Buffer) {
      const previous = files.get(remotePath);
      files.set(remotePath, {
        bytes: Buffer.from(content),
        mtime: clock++,
        mode: previous?.mode ?? 0o100644,
        uid: previous?.uid ?? 1000,
        gid: previous?.gid ?? 1000,
      });
    },
    setMode(remotePath: string, mode: number) {
      const file = files.get(remotePath);
      if (!file) throw new Error(`Missing mock remote file: ${remotePath}`);
      file.mode = 0o100000 | mode;
    },
    setOwner(remotePath: string, uid: number, gid: number) {
      const file = files.get(remotePath);
      if (!file) throw new Error(`Missing mock remote file: ${remotePath}`);
      file.uid = uid;
      file.gid = gid;
    },
  };
}

async function loadSSHManager() {
  vi.resetModules();
  vi.doMock('ssh2', () => {
    class MockClient extends MiniEmitter {
      shell = mocks.shellMock;
      connect = mocks.connectMock;
      forwardOut = mocks.forwardOutMock;
      sftp = vi.fn();
      end = vi.fn();

      constructor() {
        super();
        mocks.lastClient = this;
        mocks.clients.push(this);
      }
    }

    return { Client: MockClient };
  });

  return import('../../src/main/ssh');
}

beforeEach(() => {
  mocks.shellMock.mockReset();
  mocks.connectMock.mockReset();
  mocks.forwardOutMock.mockReset();
  mocks.lastClient = null;
  mocks.clients = [];
  vi.resetModules();
});

describe('SSHManager', () => {
  it('rejects recursive and self jump routes before allocating a client', async () => {
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    expect(() => manager.connect('recursive', {
      host: 'target.internal', port: 22, auth: 'password',
      jumpHost: {
        host: 'bastion.example', port: 22, auth: 'password',
        jumpHost: { host: 'other.example', port: 22, auth: 'password' },
      } as any,
    })).toThrow(/jump host/i);
    expect(() => manager.connect('self', {
      host: 'target.internal', port: 22, auth: 'password',
      jumpHost: { host: 'target.internal', port: 22, auth: 'password' },
    })).toThrow(/itself/i);
    expect(mocks.clients).toHaveLength(0);
  });

  it('connects the target through a verified jump host transport', async () => {
    mocks.connectMock.mockImplementation(function (this: MiniEmitter) {
      queueMicrotask(() => this.emit('ready'));
    });
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    const tunnel = new MiniEmitter();
    mocks.forwardOutMock.mockImplementationOnce((_srcHost, _srcPort, _host, _port, callback) => callback(undefined, tunnel));
    const config = {
      host: 'target.internal', port: 22, username: 'target-user', auth: 'password',
      jumpHost: { host: 'bastion.example', port: 2222, username: 'jump-user', auth: 'key', privateKey: 'jump-key' },
    };
    const connected = manager.connect('routed', config);
    const duplicate = manager.connect('routed', config);
    expect(duplicate).toBe(connected);
    await Promise.all([connected, duplicate]);

    expect(mocks.clients).toHaveLength(2);
    expect(mocks.clients[0].connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'bastion.example', port: 2222 }));
    expect(mocks.clients[1].connect).toHaveBeenCalledWith(expect.objectContaining({ sock: tunnel, username: 'target-user' }));
  });

  it('cancels an in-flight jump route when its target disconnects', async () => {
    mocks.connectMock.mockImplementation(() => {});
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    const connected = manager.connect('routed', {
      host: 'target.internal', port: 22, auth: 'password',
      jumpHost: { host: 'bastion.example', port: 22, auth: 'password' },
    });
    const rejection = expect(connected).rejects.toThrow(/cancelled/i);

    await manager.disconnect('routed');

    await rejection;
    expect(mocks.clients).toHaveLength(1);
    expect(mocks.clients[0].end).toHaveBeenCalledOnce();
  });

  it('starts a loopback local forward and closes it on stop', async () => {
    mocks.connectMock.mockImplementation(function (this: MiniEmitter) {
      queueMicrotask(() => this.emit('ready'));
    });
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('forwarded', { host: 'target.internal', port: 22, auth: 'password' });

    const status = await manager.startLocalForward('forwarded', {
      id: 'database', localPort: 0, destinationHost: '127.0.0.1', destinationPort: 5432,
    });
    expect(status).toMatchObject({ id: 'database', bindHost: '127.0.0.1', destinationPort: 5432, status: 'running' });
    expect(status.localPort).toBeGreaterThan(0);
    expect(manager.listLocalForwards('forwarded')).toEqual([status]);
    await manager.stopLocalForward('forwarded', 'database');
    expect(manager.listLocalForwards('forwarded')).toEqual([]);
  });
  it.each([
    ['empty session id', ' ', { host: 'example.com', port: 22, auth: 'password' }],
    ['empty host', 'invalid-session', { host: ' ', port: 22, auth: 'password' }],
    ['zero port', 'invalid-session', { host: 'example.com', port: 0, auth: 'password' }],
    ['oversized port', 'invalid-session', { host: 'example.com', port: 65_536, auth: 'password' }],
    ['fractional port', 'invalid-session', { host: 'example.com', port: 22.5, auth: 'password' }],
    ['unknown auth', 'invalid-session', { host: 'example.com', port: 22, auth: 'agent' }],
  ])('rejects an invalid SSH endpoint: %s', (_label, sessionId, config) => {
    const managerPromise = loadSSHManager();

    return managerPromise.then(({ SSHManager }) => {
      const manager = new SSHManager();
      expect(() => manager.connect(sessionId, config)).toThrow(/valid SSH (session id|host|port|auth)/i);
      expect(mocks.connectMock).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['username', { username: {} }],
    ['password', { password: {} }],
    ['private key', { privateKey: {} }],
  ])('rejects a malformed optional SSH %s before reserving capacity', async (_label, field) => {
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();

    expect(() => manager.connect('malformed-optional', {
      host: 'example.com', port: 22, auth: 'password', ...field,
    } as any)).toThrow(/valid SSH (username|password|private key)/i);
    expect(mocks.connectMock).not.toHaveBeenCalled();

    for (let index = 0; index < 64; index += 1) {
      void manager.connect(`session-${index}`, { host: 'example.com', port: 22, auth: 'password' });
    }
    expect(mocks.connectMock).toHaveBeenCalledTimes(64);
  });

  it.each([
    ['username', { username: 'u'.repeat(257) }],
    ['password', { password: 'p'.repeat(100_001) }],
    ['private key', { privateKey: 'k'.repeat(100_001) }],
  ])('rejects an oversized optional SSH %s before client allocation', async (_label, field) => {
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();

    expect(() => manager.connect('oversized-optional', {
      host: 'example.com', port: 22, auth: 'password', ...field,
    })).toThrow(/valid SSH (username|password|private key)/i);
    expect(mocks.connectMock).not.toHaveBeenCalled();
  });

  it('caps distinct pending and active SSH transports before client allocation', async () => {
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    for (let index = 0; index < 64; index += 1) {
      void manager.connect(`session-${index}`, {
        host: 'example.com', port: 22, auth: 'password',
      });
    }

    expect(() => manager.connect('session-64', {
      host: 'example.com', port: 22, auth: 'password',
    })).toThrow(/SSH connection limit of 64/i);
    expect(mocks.connectMock).toHaveBeenCalledTimes(64);
  });

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

  it('caps pending and active SSH shells before channel allocation', async () => {
    mocks.shellMock.mockImplementation(() => {});
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('shell-limit-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    for (let index = 0; index < 64; index += 1) {
      manager.createShell('shell-limit-session', `shell-limit-${index}`, { cols: 80, rows: 24 });
    }

    expect(() => manager.createShell(
      'shell-limit-session', 'shell-limit-64', { cols: 80, rows: 24 },
    )).toThrow(/SSH shell limit of 64/i);
    expect(mocks.shellMock).toHaveBeenCalledTimes(64);
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

  it('rejects readiness and releases capacity when queued input cannot flush', async () => {
    const stream = new MockShellStream();
    stream.write.mockImplementationOnce(() => { throw new Error('queued write failed'); });
    let openShell: ((err: Error | undefined, stream?: MockShellStream) => void) | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: typeof openShell) => {
      openShell = cb;
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const [{ SSHManager }, { NativeTerminalCapacity }] = await Promise.all([
      loadSSHManager(), import('../../src/main/terminalCapacity'),
    ]);
    const manager = new SSHManager(undefined, undefined, undefined, new NativeTerminalCapacity(1));
    await manager.connect('flush-failure-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell(
      'flush-failure-session', 'flush-failure-term', { cols: 80, rows: 24 },
    );
    manager.writeShell('flush-failure-term', 'queued input', 'flush-failure-session');

    openShell?.(undefined, stream);
    await expect(handle.ready).rejects.toThrow(/queued write failed/i);
    expect(manager.destroyShell('flush-failure-term', 'flush-failure-session')).toBe(false);
    expect(() => manager.createShell(
      'flush-failure-session', 'replacement-term', { cols: 80, rows: 24 },
    )).not.toThrow();
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

  it('pauses SSH output above the high watermark and resumes after parsed output is acknowledged', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: Function) => cb(undefined, stream));
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('flow-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell('flow-session', 'flow-term', { cols: 80, rows: 24 });
    const received: Array<{ generation: number; sequence: number }> = [];
    handle.onData((_data, output) => received.push(output));
    await handle.ready;

    stream.emit('data', Buffer.from('x'.repeat(300_000)));
    stream.stderr.emit('data', Buffer.from('x'.repeat(224_288)));

    expect(stream.pause).toHaveBeenCalledOnce();
    expect(stream.stderr.pause).toHaveBeenCalledOnce();
    manager.acknowledgeOutput('flow-term', received[0].generation, received[0].sequence);
    expect(stream.resume).not.toHaveBeenCalled();
    manager.acknowledgeOutput('flow-term', received[1].generation, received[1].sequence);
    expect(stream.resume).toHaveBeenCalledOnce();
    expect(stream.stderr.resume).toHaveBeenCalledOnce();
  });

  it('starts fresh flow control when an existing SSH shell reattaches', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: Function) => cb(undefined, stream));
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('reattach-flow-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell(
      'reattach-flow-session', 'reattach-flow-term', { cols: 80, rows: 24 },
    );
    const firstOutput: Array<{ generation: number; sequence: number }> = [];
    handle.onData((_data, output) => firstOutput.push(output));
    await handle.ready;

    stream.emit('data', Buffer.from('x'.repeat(600_000)));
    expect(stream.pause).toHaveBeenCalledOnce();

    const currentOutput: Array<{ generation: number; sequence: number }> = [];
    handle.onData((_data, output) => {
      currentOutput.push(output);
    });
    expect(stream.resume).toHaveBeenCalledOnce();
    expect(stream.stderr.resume).toHaveBeenCalledOnce();

    stream.pause.mockClear();
    stream.stderr.pause.mockClear();
    stream.emit('data', Buffer.from('x'.repeat(600_000)));
    expect(stream.pause).toHaveBeenCalledOnce();
    expect(stream.stderr.pause).toHaveBeenCalledOnce();
    expect(currentOutput[0].generation).not.toBe(firstOutput[0].generation);
    expect(currentOutput[0].sequence).toBe(600_000);
  });

  it('does not pause SSH output that could not be delivered to the renderer', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: Function) => cb(undefined, stream));
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('undelivered-flow-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell(
      'undelivered-flow-session', 'undelivered-flow-term', { cols: 80, rows: 24 },
    );
    handle.onData(() => false);
    await handle.ready;

    stream.emit('data', Buffer.from('x'.repeat(600_000)));

    expect(stream.pause).not.toHaveBeenCalled();
    expect(stream.stderr.pause).not.toHaveBeenCalled();
  });

  it('ignores output acknowledgements from a destroyed SSH shell generation', async () => {
    const streams = [new MockShellStream(), new MockShellStream()];
    mocks.shellMock
      .mockImplementationOnce((_opts: unknown, cb: Function) => cb(undefined, streams[0]))
      .mockImplementationOnce((_opts: unknown, cb: Function) => cb(undefined, streams[1]));
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('reused-flow-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    const firstOutput: Array<{ generation: number; sequence: number }> = [];
    const first = manager.createShell('reused-flow-session', 'reused-flow-term', { cols: 80, rows: 24 });
    first.onData((_data, output) => firstOutput.push(output));
    await first.ready;
    streams[0].emit('data', Buffer.from('x'));
    manager.destroyShell('reused-flow-term', 'reused-flow-session');

    const currentOutput: Array<{ generation: number; sequence: number }> = [];
    const current = manager.createShell('reused-flow-session', 'reused-flow-term', { cols: 80, rows: 24 });
    current.onData((_data, output) => currentOutput.push(output));
    await current.ready;
    streams[1].emit('data', Buffer.from('x'.repeat(600_000)));
    expect(streams[1].pause).toHaveBeenCalledOnce();

    manager.acknowledgeOutput('reused-flow-term', firstOutput[0].generation, Number.MAX_SAFE_INTEGER);
    expect(streams[1].resume).not.toHaveBeenCalled();
    manager.acknowledgeOutput(
      'reused-flow-term', currentOutput[0].generation, currentOutput[0].sequence,
    );
    expect(streams[1].resume).toHaveBeenCalledOnce();
  });

  it.each([
    ['empty terminal id', '', { cols: 80, rows: 24 }],
    ['object terminal id', {} as unknown as string, { cols: 80, rows: 24 }],
    ['sub-unit columns', 'invalid-size', { cols: 0.5, rows: 24 }],
    ['oversized rows', 'invalid-size', { cols: 80, rows: 1_001 }],
  ])('rejects malformed SSH shell parameters: %s', async (_label, termId, size) => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('validated-shell-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });

    expect(() => manager.createShell('validated-shell-session', termId, size))
      .toThrow(/valid SSH shell (terminal id|dimensions)/i);
    expect(mocks.shellMock).not.toHaveBeenCalled();
  });

  it('bounds and normalizes SSH shell resize dimensions before the native call', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_options: unknown, callback: Function) => {
      callback(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('resize-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell('resize-session', 'resize-term', { cols: 80, rows: 24 }).ready;

    manager.resizeShell('resize-term', Number.NaN, 24);
    manager.resizeShell('resize-term', 0.5, 24);
    manager.resizeShell('resize-term', 80, 1_001);
    expect(stream.setWindow).not.toHaveBeenCalled();

    manager.resizeShell('resize-term', 80.9, 24.7);
    expect(stream.setWindow).toHaveBeenCalledOnce();
    expect(stream.setWindow).toHaveBeenCalledWith(24, 80, 0, 0);
  });

  it('times out and releases a shell whose open callback never settles', async () => {
    vi.useFakeTimers();
    try {
      mocks.shellMock.mockImplementation(() => {});
      mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
      const { SSHManager } = await loadSSHManager();
      const manager = new SSHManager();
      const connected = manager.connect('shell-timeout-session', {
        host: 'example.com', port: 22, username: 'alice', auth: 'password',
      });
      await vi.runAllTicks();
      await connected;
      const handle = manager.createShell('shell-timeout-session', 'shell-timeout-term', { cols: 80, rows: 24 });
      const rejection = expect(handle.ready).rejects.toThrow(/timed out/i);

      await vi.advanceTimersByTimeAsync(30_000);

      await rejection;
      const connection = (manager as any).connections.get('shell-timeout-session');
      expect(connection.shellHandles.has('shell-timeout-term')).toBe(false);
      expect(connection.pendingWrites.has('shell-timeout-term')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains only bounded recent output until onData is registered', async () => {
    let stream: MockShellStream | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, callback: Function) => {
      stream = new MockShellStream();
      callback(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('bounded-output-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell('bounded-output-session', 'bounded-output-term', { cols: 80, rows: 24 });
    await handle.ready;

    for (let index = 0; index < 300; index += 1) {
      stream?.emit('data', Buffer.from(`${String(index).padStart(3, '0')}:${'x'.repeat(4_096)}`));
    }
    const received: string[] = [];
    handle.onData((chunk) => received.push(chunk));

    expect(Buffer.byteLength(received.join(''))).toBeLessThanOrEqual(1024 * 1024);
    expect(received.join('')).toContain('299:');
    expect(received.join('')).not.toContain('000:');
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

  it('cancels a pending shell before queued input can exhaust memory', async () => {
    mocks.shellMock.mockImplementation(() => {});
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('bounded-input-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const handle = manager.createShell('bounded-input-session', 'bounded-input-term', { cols: 80, rows: 24 });
    const rejected = expect(handle.ready).rejects.toThrow(/input limit/i);

    for (let index = 0; index < 256; index += 1) {
      manager.writeShell('bounded-input-term', 'x'.repeat(4_096), 'bounded-input-session');
    }
    expect(() => manager.writeShell('bounded-input-term', 'overflow', 'bounded-input-session'))
      .toThrow(/input limit/i);

    await rejected;
    const connection = (manager as any).connections.get('bounded-input-session');
    expect(connection.pendingWrites.has('bounded-input-term')).toBe(false);
    expect(connection.shellHandles.has('bounded-input-term')).toBe(false);
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

  it.each([
    ['text', 'x', (manager: any, value: unknown) => manager.writeShell('bounded-live-term', value, 'bounded-live-session')],
    ['binary', '\xff', (manager: any, value: unknown) => manager.writeShellBinary('bounded-live-term', value, 'bounded-live-session')],
  ])('rejects malformed and oversized live SSH %s writes before native code', async (_label, byte, write) => {
    let stream: MockShellStream | undefined;
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (err: Error | undefined, channel?: MockShellStream) => void) => {
      stream = new MockShellStream();
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('bounded-live-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    await manager.createShell('bounded-live-session', 'bounded-live-term', { cols: 80, rows: 24 }).ready;

    expect(() => write(manager, null)).toThrow(/shell data/i);
    expect(() => write(manager, byte.repeat(1024 * 1024 + 1))).toThrow(/shell data/i);
    expect(stream?.write).not.toHaveBeenCalled();
    expect(() => write(manager, byte.repeat(1024 * 1024))).not.toThrow();
    expect(stream?.write).toHaveBeenCalledOnce();
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
    const mismatchedPending = manager.connect('same-session', {
      host: 'example.com', port: 22, username: 'bob', auth: 'password',
    });
    expect(mocks.connectMock).toHaveBeenCalledTimes(1);

    mocks.lastClient?.emit('ready');
    await expect(mismatchedPending).rejects.toThrow(/different configuration/i);
    await Promise.all([first, second]);
    await manager.connect('same-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    await expect(manager.connect('same-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'key', privateKey: 'new-key',
    })).rejects.toThrow(/different configuration/i);
    expect(mocks.connectMock).toHaveBeenCalledTimes(1);
    expect(manager.listConnections()).toHaveLength(1);

    mocks.lastClient?.emit('close');
    expect(manager.listConnections()).toHaveLength(0);
  });

  it('does not expose a reusable credential digest across manager instances', async () => {
    mocks.connectMock.mockImplementation(() => {});
    const { SSHManager } = await loadSSHManager();
    const config = {
      host: 'example.com', port: 22, username: 'alice', auth: 'password', password: 'secret',
    };
    const first = new SSHManager();
    const second = new SSHManager();

    const firstConnection = first.connect('session', config);
    const secondConnection = second.connect('session', config);

    expect((first as any).pendingConnections.get('session').identity)
      .not.toBe((second as any).pendingConnections.get('session').identity);
    const firstCancelled = expect(firstConnection).rejects.toThrow(/cancelled/i);
    const secondCancelled = expect(secondConnection).rejects.toThrow(/cancelled/i);
    await first.disconnect('session');
    await second.disconnect('session');
    await Promise.all([firstCancelled, secondCancelled]);
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

  it('closes live SSH shells during manager cleanup', async () => {
    const stream = new MockShellStream();
    mocks.shellMock.mockImplementation((_opts: unknown, cb: (error: Error | undefined, channel?: MockShellStream) => void) => {
      cb(undefined, stream);
    });
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('cleanup-session', { host: 'example.com', port: 22, username: 'alice', auth: 'password' });
    await manager.createShell('cleanup-session', 'cleanup-term', { cols: 80, rows: 24 }).ready;

    manager.cleanup();

    expect(stream.close).toHaveBeenCalledTimes(1);
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
      connectionId: expect.any(String),
      resolvedPath: '/home/alice',
      entries: [],
    });
    expect(sftp.realpath).toHaveBeenCalledWith('.', expect.any(Function));
    expect(sftp.readdir).toHaveBeenCalledWith('/home/alice', expect.any(Function));
    expect(sftp.end).toHaveBeenCalledTimes(1);
  });

  it('reads a regular remote UTF-8 file through bounded SFTP handle reads', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-read-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'hello €\n' });
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-read-session').connectionId;

    const result = await manager.readTextFile({
      sessionId: 'text-read-session',
      connectionId,
      remotePath: '/repo/readme.md',
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        requestedPath: '/repo/readme.md',
        resolvedPath: '/repo/readme.md',
        content: 'hello €\n',
        encoding: 'utf8',
        hasUtf8Bom: false,
        revision: expect.objectContaining({
          token: expect.stringMatching(/^[a-f0-9]{64}$/),
          size: Buffer.byteLength('hello €\n'),
        }),
      }),
    });
    expect(remote.sftp.read).toHaveBeenCalled();
    expect((remote.sftp as any).readFile).toBeUndefined();
    expect(remote.sftp.open).toHaveBeenCalledWith('/repo/readme.md', 'r', expect.any(Function));
    expect(remote.sftp.end).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed SSH text-read IPC requests before opening SFTP', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-read-boundary-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const client = mocks.lastClient as any;
    const connectionId = (manager as any).connections.get('text-read-boundary-session').connectionId;
    const valid = {
      sessionId: 'text-read-boundary-session',
      connectionId,
      remotePath: '/repo/readme.md',
    };
    const throwingRequest: Record<string, unknown> = {
      connectionId,
      remotePath: '/repo/readme.md',
    };
    Object.defineProperty(throwingRequest, 'sessionId', {
      enumerable: true,
      get: () => { throw new Error('getter must be contained'); },
    });

    const malformed: unknown[] = [
      undefined,
      null,
      [],
      {},
      { ...valid, extra: true },
      { ...valid, sessionId: 42 },
      { ...valid, connectionId: null },
      { sessionId: valid.sessionId, connectionId },
      { ...valid, remotePath: 42 },
      { ...valid, remotePath: '' },
      throwingRequest,
    ];

    for (const request of malformed) {
      await expect(manager.readTextFile(request)).resolves.toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      });
    }
    expect(client.sftp).not.toHaveBeenCalled();
  });

  it('rejects malformed SSH text-write IPC requests and nested revisions before SFTP', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-write-boundary-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const client = mocks.lastClient as any;
    const connectionId = (manager as any).connections.get('text-write-boundary-session').connectionId;
    const revision = {
      token: 'a'.repeat(64),
      size: 8,
      mtime: new Date(0).toISOString(),
    };
    const valid = {
      sessionId: 'text-write-boundary-session',
      connectionId,
      requestedPath: '/repo/readme.md',
      resolvedPath: '/repo/readme.md',
      expectedRevision: revision,
      content: 'updated\n',
      hasUtf8Bom: false,
    };
    const { content: _content, ...missingContent } = valid;

    const malformed: unknown[] = [
      undefined,
      null,
      [],
      {},
      missingContent,
      { ...valid, extra: true },
      { ...valid, sessionId: 42 },
      { ...valid, connectionId: null },
      { ...valid, requestedPath: 42 },
      { ...valid, resolvedPath: '' },
      { ...valid, content: Buffer.from('updated') },
      { ...valid, hasUtf8Bom: 'false' },
      { ...valid, overwrite: undefined },
      { ...valid, overwrite: 'yes' },
      { ...valid, expectedRevision: { ...revision, extra: true } },
      { ...valid, expectedRevision: { ...revision, size: '8' } },
      { ...valid, expectedRevision: { ...revision, fileId: undefined } },
      { ...valid, expectedRevision: null },
    ];

    for (const request of malformed) {
      await expect(manager.writeTextFile(request)).resolves.toEqual({
        ok: false,
        error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      });
    }
    expect(client.sftp).not.toHaveBeenCalled();
  });

  it('rejects a text read bound to an older ready transport before opening SFTP', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-reuse-session', {
      host: 'old.example.com', port: 22, username: 'alice', auth: 'password',
    });
    const oldConnectionId = (manager as any).connections.get('text-reuse-session').connectionId;
    await manager.disconnect('text-reuse-session');
    await manager.connect('text-reuse-session', {
      host: 'new.example.com', port: 22, username: 'alice', auth: 'password',
    });
    const replacementClient = mocks.lastClient as any;
    const newConnectionId = (manager as any).connections.get('text-reuse-session').connectionId;

    await expect(manager.readTextFile({
      sessionId: 'text-reuse-session',
      connectionId: oldConnectionId,
      remotePath: '/repo/readme.md',
    })).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'STALE_SSH_SESSION' }),
    });
    expect(newConnectionId).not.toBe(oldConnectionId);
    expect(replacementClient.sftp).not.toHaveBeenCalled();
  });

  it('returns a conflict without creating a temp when the remote bytes changed after open', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-conflict-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-conflict-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-conflict-session', connectionId, remotePath: '/repo/readme.md',
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error('expected remote file to open');
    remote.setFile('/repo/readme.md', 'changed elsewhere\n');

    const saved = await manager.writeTextFile({
      sessionId: 'text-conflict-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'my edit\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'CONFLICT' }),
    });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('changed elsewhere\n');
    expect(remote.sftp.open.mock.calls.some(([, flags]) => flags === 'wx')).toBe(false);
    expect(remote.sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });

  it('saves through an exclusive temp and atomic OpenSSH rename without truncating the destination', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-save-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    remote.setMode('/repo/readme.md', 0o750);
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-save-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-save-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const saved = await manager.writeTextFile({
      sessionId: 'text-save-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'saved safely\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: true,
      value: expect.objectContaining({
        requestedPath: '/repo/readme.md',
        resolvedPath: '/repo/readme.md',
        revision: expect.objectContaining({ token: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      }),
    });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('saved safely\n');
    const exclusiveOpen = remote.sftp.open.mock.calls.find(([, flags]) => flags === 'wx');
    expect(exclusiveOpen?.[0]).toMatch(/^\/repo\/\.janet-save-[a-f0-9-]+\.tmp$/);
    expect(remote.sftp.ext_openssh_rename).toHaveBeenCalledWith(
      exclusiveOpen?.[0], '/repo/readme.md', expect.any(Function),
    );
    expect(remote.sftp.fsetstat).toHaveBeenCalledWith(
      expect.any(Buffer), { mode: 0o750 }, expect.any(Function),
    );
    expect(remote.sftp.ext_openssh_fsync).toHaveBeenCalledWith(
      expect.any(Buffer), expect.any(Function),
    );
    expect((remote.files.get('/repo/readme.md')?.mode ?? 0) & 0o7777).toBe(0o750);
    expect(remote.files.get('/repo/readme.md')).toMatchObject({ uid: 1000, gid: 1000 });
    expect((remote.sftp as any).rename).toBeUndefined();
    expect(remote.sftp.unlink).not.toHaveBeenCalled();
  });

  it('refuses to replace a remote target carrying special permission bits', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-special-mode-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/tool': 'original\n' });
    remote.setMode('/repo/tool', 0o4755);
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-special-mode-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-special-mode-session', connectionId, remotePath: '/repo/tool',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const saved = await manager.writeTextFile({
      sessionId: 'text-special-mode-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'must not replace\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SAFE_REPLACE_UNAVAILABLE' }),
    });
    expect(remote.files.get('/repo/tool')?.bytes.toString()).toBe('original\n');
    expect(remote.sftp.open.mock.calls.some(([, flags]) => flags === 'wx')).toBe(false);
    expect(remote.sftp.fsetstat).not.toHaveBeenCalled();
    expect(remote.sftp.ext_openssh_rename).not.toHaveBeenCalled();
  });

  it('refuses atomic replacement when the owned temp cannot preserve target ownership', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-owner-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    remote.setOwner('/repo/readme.md', 2000, 1000);
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-owner-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-owner-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const saved = await manager.writeTextFile({
      sessionId: 'text-owner-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'must not replace\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SAFE_REPLACE_UNAVAILABLE' }),
    });
    expect(remote.files.get('/repo/readme.md')).toMatchObject({ uid: 2000, gid: 1000 });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('original\n');
    expect(remote.sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(remote.sftp.unlink).toHaveBeenCalledTimes(1);
  });

  it('refuses replacement when fsetstat does not actually preserve ordinary permissions', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-mode-verify-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    remote.setMode('/repo/readme.md', 0o750);
    remote.sftp.fsetstat.mockImplementation((
      _handle: Buffer,
      _attrs: { mode?: number },
      callback: (error?: Error) => void,
    ) => callback());
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-mode-verify-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-mode-verify-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const saved = await manager.writeTextFile({
      sessionId: 'text-mode-verify-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'must not replace\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SAFE_REPLACE_UNAVAILABLE' }),
    });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('original\n');
    expect(remote.sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(remote.sftp.unlink).toHaveBeenCalledTimes(1);
  });

  it('keeps atomic replacement available when the optional OpenSSH fsync is unsupported', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-no-fsync-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    remote.sftp.ext_openssh_fsync.mockImplementation(() => {
      throw new Error('Server does not support this extended request');
    });
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-no-fsync-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-no-fsync-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const saved = await manager.writeTextFile({
      sessionId: 'text-no-fsync-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'saved without fsync extension\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({ ok: true, value: expect.any(Object) });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('saved without fsync extension\n');
    expect(remote.sftp.ext_openssh_rename).toHaveBeenCalledTimes(1);
  });

  it('rechecks the destination after upload and preserves a racing remote change', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-race-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-race-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-race-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const normalWrite = remote.sftp.write.getMockImplementation();
    let injectedRace = false;
    remote.sftp.write.mockImplementation((...args: any[]) => {
      (normalWrite as Function | undefined)?.apply(remote.sftp, args);
      if (!injectedRace) {
        injectedRace = true;
        remote.setFile('/repo/readme.md', 'racing change\n');
      }
    });

    const saved = await manager.writeTextFile({
      sessionId: 'text-race-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'my edit\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'CONFLICT' }),
    });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('racing change\n');
    expect(remote.sftp.ext_openssh_rename).not.toHaveBeenCalled();
    expect(remote.sftp.unlink).toHaveBeenCalledTimes(1);
  });

  it('serializes saves to one remote file so a queued stale save conflicts', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-serialized-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    const client = mocks.lastClient as any;
    client.sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-serialized-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-serialized-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    let finishRename!: () => void;
    remote.sftp.ext_openssh_rename.mockImplementation((
      sourcePath: string,
      destinationPath: string,
      callback: (error?: Error) => void,
    ) => {
      finishRename = () => {
        const source = remote.files.get(sourcePath);
        if (!source) throw new Error('expected owned temp');
        remote.files.set(destinationPath, source);
        remote.files.delete(sourcePath);
        callback();
      };
    });
    client.sftp.mockClear();
    const first = manager.writeTextFile({
      sessionId: 'text-serialized-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'first save\n',
      hasUtf8Bom: false,
    });
    while (!finishRename) await Promise.resolve();
    const second = manager.writeTextFile({
      sessionId: 'text-serialized-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'stale queued save\n',
      hasUtf8Bom: false,
    });

    await Promise.resolve();
    expect(client.sftp).toHaveBeenCalledTimes(1);
    finishRename();
    await expect(first).resolves.toEqual({ ok: true, value: expect.any(Object) });
    await expect(second).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'CONFLICT' }),
    });
    expect(client.sftp).toHaveBeenCalledTimes(2);
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('first save\n');
  });

  it('refuses an unsafe replacement and cleans up only its owned temp file', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));

    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('text-unsafe-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const remote = createTextFileSftp({ '/repo/readme.md': 'original\n' });
    (remote.sftp as any).ext_openssh_rename = undefined;
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, remote.sftp));
    const connectionId = (manager as any).connections.get('text-unsafe-session').connectionId;
    const opened = await manager.readTextFile({
      sessionId: 'text-unsafe-session', connectionId, remotePath: '/repo/readme.md',
    });
    if (!opened.ok) throw new Error('expected remote file to open');

    const saved = await manager.writeTextFile({
      sessionId: 'text-unsafe-session',
      connectionId,
      requestedPath: opened.value.requestedPath,
      resolvedPath: opened.value.resolvedPath,
      expectedRevision: opened.value.revision,
      content: 'must not replace\n',
      hasUtf8Bom: false,
    });

    expect(saved).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'SAFE_REPLACE_UNAVAILABLE' }),
    });
    expect(remote.files.get('/repo/readme.md')?.bytes.toString()).toBe('original\n');
    expect(remote.sftp.unlink).toHaveBeenCalledTimes(1);
    const cleanedPath = remote.sftp.unlink.mock.calls[0][0];
    expect(cleanedPath).toMatch(/^\/repo\/\.janet-save-/);
    expect(remote.files.has(cleanedPath)).toBe(false);
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

  it('rejects oversized SFTP directory responses before mapping entries', async () => {
    mocks.connectMock.mockImplementation(() => queueMicrotask(() => mocks.lastClient?.emit('ready')));
    const { SSHManager } = await loadSSHManager();
    const manager = new SSHManager();
    await manager.connect('oversized-listing-session', {
      host: 'example.com', port: 22, username: 'alice', auth: 'password',
    });
    const attrs = {
      isDirectory: vi.fn(() => false),
      isSymbolicLink: vi.fn(() => false),
      size: 0, mode: 0o644, mtime: 1,
    };
    const sftp = {
      end: vi.fn(),
      realpath: vi.fn((_path: string, callback: Function) => callback(undefined, '/huge')),
      readdir: vi.fn((_path: string, callback: Function) => callback(undefined,
        Array.from({ length: 10_001 }, (_, index) => ({ filename: `file-${index}`, attrs })))),
      stat: vi.fn(),
    };
    (mocks.lastClient as any).sftp.mockImplementation((callback: Function) => callback(undefined, sftp));

    await expect(manager.listDir('oversized-listing-session', '/huge'))
      .rejects.toThrow(/too many directory entries/i);
    expect(attrs.isDirectory).not.toHaveBeenCalled();
    expect(sftp.stat).not.toHaveBeenCalled();
    expect(sftp.end).toHaveBeenCalledOnce();
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
