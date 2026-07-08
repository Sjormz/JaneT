import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}));

import { TerminalManager } from '../../src/main/terminal';

type ExitHandler = (event: { exitCode: number; signal: number }) => void;

function makePty() {
  const exitHandlers: ExitHandler[] = [];
  return {
    pid: 1234,
    onData: vi.fn(),
    onExit: vi.fn((handler: ExitHandler) => {
      exitHandlers.push(handler);
      return { dispose: vi.fn() };
    }),
    resize: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    emitExit(event = { exitCode: 0, signal: 0 }) {
      for (const handler of exitHandlers) handler(event);
    },
  };
}

describe('TerminalManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes a terminal after the pty exits so later resize is ignored', () => {
    const pty = makePty();
    spawnMock.mockReturnValue(pty);

    const manager = new TerminalManager();
    manager.create('term-1');

    pty.emitExit();
    manager.resize('term-1', 100, 30);

    expect(pty.resize).not.toHaveBeenCalled();
  });

  it('evicts a stale terminal when resize races with an already-dead pty', () => {
    const pty = makePty();
    const ebadf = new Error('ioctl(2) failed, EBADF');
    pty.resize.mockImplementation(() => {
      throw ebadf;
    });
    spawnMock.mockReturnValue(pty);

    const manager = new TerminalManager();
    manager.create('term-1');

    expect(() => manager.resize('term-1', 100, 30)).not.toThrow();
    expect(pty.resize).toHaveBeenCalledTimes(1);

    pty.resize.mockClear();
    manager.resize('term-1', 120, 40);
    expect(pty.resize).not.toHaveBeenCalled();
  });
});
