import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  shell: vi.fn(),
  client: null as { emit: (event: string, ...args: unknown[]) => void } | null,
}));

vi.mock('node-pty', () => ({ spawn: mocks.spawn }));
vi.mock('ssh2', () => ({
  Client: class {
    private listeners = new Map<string, Array<(...args: any[]) => void>>();
    shell = mocks.shell;
    end = vi.fn();
    on(event: string, listener: (...args: any[]) => void) {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }
    connect() {
      queueMicrotask(() => this.emit('ready'));
    }
    constructor() {
      mocks.client = this;
    }
  },
}));

import { NativeTerminalCapacity } from '../../src/main/terminalCapacity';
import { TerminalManager } from '../../src/main/terminal';
import { SSHManager } from '../../src/main/ssh';

function localPty() {
  let exit: (() => void) | undefined;
  return {
    pid: 123,
    onData: vi.fn(),
    onExit: vi.fn((listener: () => void) => { exit = listener; return { dispose: vi.fn() }; }),
    resize: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    emitExit: () => exit?.(),
  };
}

function sshStream() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    stderr: { on: vi.fn() }, write: vi.fn(), close: vi.fn(), setWindow: vi.fn(),
    on(event: string, listener: (...args: any[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
}

describe('shared native terminal capacity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client = null;
  });

  it('counts local PTYs and SSH shells against one ceiling and releases destroyed owners', async () => {
    const pty = localPty();
    mocks.spawn.mockReturnValue(pty);
    mocks.shell.mockImplementation(() => {});
    const capacity = new NativeTerminalCapacity(1);
    const terminals = new TerminalManager({ capacity });
    const ssh = new SSHManager(undefined, undefined, undefined, capacity);

    terminals.create('local');
    await ssh.connect('ssh', { host: 'example.com', port: 22, auth: 'password' });

    expect(() => ssh.createShell('ssh', 'remote', { cols: 80, rows: 24 }))
      .toThrow(/native terminal limit of 1/i);
    expect(mocks.shell).not.toHaveBeenCalled();

    terminals.destroy('local');
    expect(() => ssh.createShell('ssh', 'remote', { cols: 80, rows: 24 })).not.toThrow();
    expect(mocks.shell).toHaveBeenCalledOnce();
  });

  it('rejects a terminal id shared by a local PTY and SSH shell', async () => {
    mocks.spawn.mockReturnValue(localPty());
    mocks.shell.mockImplementation(() => {});
    const capacity = new NativeTerminalCapacity(2);
    const terminals = new TerminalManager({ capacity });
    const ssh = new SSHManager(undefined, undefined, undefined, capacity);

    terminals.create('shared');
    await ssh.connect('ssh', { host: 'example.com', port: 22, auth: 'password' });

    expect(() => ssh.createShell('ssh', 'shared', { cols: 80, rows: 24 }))
      .toThrow(/terminal id.*already in use/i);
    expect(mocks.shell).not.toHaveBeenCalled();
  });

  it('releases shared capacity when a ready SSH channel closes normally', async () => {
    const streams = [sshStream(), sshStream()];
    mocks.shell.mockImplementation((_options: unknown, callback: Function) => {
      callback(undefined, streams[mocks.shell.mock.calls.length - 1]);
    });
    const capacity = new NativeTerminalCapacity(1);
    const ssh = new SSHManager(undefined, undefined, undefined, capacity);
    await ssh.connect('ssh', { host: 'example.com', port: 22, auth: 'password' });

    await ssh.createShell('ssh', 'first', { cols: 80, rows: 24 }).ready;
    streams[0].emit('close');

    const second = ssh.createShell('ssh', 'second', { cols: 80, rows: 24 });
    await expect(second.ready).resolves.toBeUndefined();
  });

  it('does not alias distinct SSH owners whose ids contain delimiters', async () => {
    mocks.shell.mockImplementation(() => {});
    const capacity = new NativeTerminalCapacity(1);
    const ssh = new SSHManager(undefined, undefined, undefined, capacity);
    await ssh.connect('a:b', { host: 'first.example.com', port: 22, auth: 'password' });
    await ssh.connect('a', { host: 'second.example.com', port: 22, auth: 'password' });

    ssh.createShell('a:b', 'c', { cols: 80, rows: 24 });

    expect(() => ssh.createShell('a', 'b:c', { cols: 80, rows: 24 }))
      .toThrow(/native terminal limit of 1/i);
    expect(mocks.shell).toHaveBeenCalledOnce();
  });

  it('rejects one SSH terminal id being owned by two sessions', async () => {
    mocks.shell.mockImplementation(() => {});
    const ssh = new SSHManager();
    await ssh.connect('first', { host: 'first.example.com', port: 22, auth: 'password' });
    await ssh.connect('second', { host: 'second.example.com', port: 22, auth: 'password' });

    ssh.createShell('first', 'shared', { cols: 80, rows: 24 });

    expect(() => ssh.createShell('second', 'shared', { cols: 80, rows: 24 }))
      .toThrow(/terminal id.*already in use/i);
    expect(mocks.shell).toHaveBeenCalledOnce();
  });
});
