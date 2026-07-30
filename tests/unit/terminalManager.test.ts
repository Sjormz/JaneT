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

  it('reports the native exit code and signal once', () => {
    const pty = makePty();
    spawnMock.mockReturnValue(pty);
    const onExit = vi.fn();
    const manager = new TerminalManager();

    manager.create('term-exit', undefined, undefined, undefined, undefined, onExit);
    pty.emitExit({ exitCode: 17, signal: 9 });

    expect(onExit).toHaveBeenCalledOnce();
    expect(onExit).toHaveBeenCalledWith({ exitCode: 17, signal: 9 });
  });

  it.each([
    'ioctl(2) failed, EBADF',
    'Cannot resize a pty that has already exited',
  ])('evicts a stale terminal when resize reports %s', (message) => {
    const pty = makePty();
    pty.resize.mockImplementation(() => {
      throw new Error(message);
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

  it('rejects malformed ids and caps the number of live terminals', () => {
    spawnMock.mockImplementation(() => makePty());
    const manager = new TerminalManager();

    expect(() => manager.create('')).toThrow(/terminal id/i);
    expect(() => manager.create({} as unknown as string)).toThrow(/terminal id/i);
    expect(() => manager.create('x'.repeat(257))).toThrow(/terminal id/i);
    for (let index = 0; index < 64; index += 1) manager.create(`term-${index}`);
    expect(() => manager.create('term-over-limit')).toThrow(/terminal limit/i);
    expect(spawnMock).toHaveBeenCalledTimes(64);
  });

  it.each([
    ['text', 'x', (manager: TerminalManager, value: unknown) => manager.write('term-1', value as string)],
    ['binary', '\xff', (manager: TerminalManager, value: unknown) => manager.writeBinary('term-1', value as string)],
  ])('rejects malformed and oversized %s writes before native code', (_label, byte, write) => {
    const pty = makePty();
    spawnMock.mockReturnValue(pty);
    const manager = new TerminalManager();
    manager.create('term-1');

    expect(() => write(manager, null)).toThrow(/terminal data/i);
    expect(() => write(manager, byte.repeat(1024 * 1024 + 1))).toThrow(/terminal data/i);
    expect(pty.write).not.toHaveBeenCalled();
    expect(() => write(manager, byte.repeat(1024 * 1024))).not.toThrow();
    expect(pty.write).toHaveBeenCalledOnce();
  });
});
