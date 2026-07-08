import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

class MockPty {
  pid = 4242;
  onDataCallbacks: Array<(data: string) => void> = [];
  killed = false;

  onData(cb: (data: string) => void) {
    this.onDataCallbacks.push(cb);
    return { dispose: vi.fn() };
  }

  resize = vi.fn();
  write = vi.fn();
  kill = vi.fn(() => {
    this.killed = true;
  });

  /** Test helper: simulate the pty emitting a chunk of output. */
  emit(data: string) {
    for (const cb of this.onDataCallbacks) cb(data);
  }
}

const mocks = {
  spawnMock: vi.fn(),
};

async function loadTerminalManager() {
  vi.resetModules();
  vi.doMock('node-pty', () => ({
    spawn: mocks.spawnMock,
  }));
  return import('../../src/main/terminal');
}

beforeEach(() => {
  mocks.spawnMock.mockReset();
  vi.resetModules();
});

describe('TerminalManager', () => {
  it('spawns exactly one pty when create() is called twice for the same id (StrictMode double-mount)', async () => {
    const ptys: MockPty[] = [];
    mocks.spawnMock.mockImplementation(() => {
      const pty = new MockPty();
      ptys.push(pty);
      return pty;
    });

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    // Simulates React 18 StrictMode's mount -> cleanup -> mount, which
    // calls the IPC handler (and therefore create()) twice for the same
    // termId before the first call's caller has any chance to react.
    const first = manager.create('term-1', undefined, undefined, () => {});
    const second = manager.create('term-1', undefined, undefined, () => {});

    expect(mocks.spawnMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('only ever wires one onData forwarder per id, even across repeat create() calls', async () => {
    const ptys: MockPty[] = [];
    mocks.spawnMock.mockImplementation(() => {
      const pty = new MockPty();
      ptys.push(pty);
      return pty;
    });

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    manager.create('term-1', undefined, undefined, (d) => receivedA.push(d));
    manager.create('term-1', undefined, undefined, (d) => receivedB.push(d));

    // Only the first forwarder should ever have been attached — a second
    // call must not add a second listener to the same underlying pty.
    ptys[0].emit('PS C:\\Users\\pckpr> ');

    expect(receivedA).toEqual(['PS C:\\Users\\pckpr> ']);
    expect(receivedB).toEqual([]);
  });

  it('destroy() kills the pty and a later create() with the same id spawns a fresh one', async () => {
    const ptys: MockPty[] = [];
    mocks.spawnMock.mockImplementation(() => {
      const pty = new MockPty();
      ptys.push(pty);
      return pty;
    });

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-1', undefined, undefined, () => {});
    manager.destroy('term-1');
    manager.create('term-1', undefined, undefined, () => {});

    expect(mocks.spawnMock).toHaveBeenCalledTimes(2);
    expect(ptys[0].killed).toBe(true);
  });

  it('starts zsh with a JaneT-owned zshrc so OSC 7 hooks survive on mac', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-zsh', undefined, '/bin/zsh', () => {});

    expect(mocks.spawnMock).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-i'],
      expect.objectContaining({
        env: expect.objectContaining({
          ZDOTDIR: expect.stringContaining('janet-zdotdir'),
          SHELL: '/bin/zsh',
        }),
      }),
    );
  });

  it('starts bash with --rcfile so PROMPT_COMMAND lives in the interactive shell', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-bash', undefined, 'bash', () => {});

    expect(mocks.spawnMock.mock.calls[0][1]).toEqual([
      '--rcfile',
      `${os.tmpdir()}${path.sep}janet-bashrc`,
      '-i',
    ]);
  });

  it('ignores invalid and duplicate resize requests before calling node-pty', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-1', undefined, undefined, () => {});
    manager.resize('term-1', 0, 24);
    manager.resize('term-1', Number.NaN, 24);
    manager.resize('term-1', 80, 24);
    expect(pty.resize).not.toHaveBeenCalled();

    manager.resize('term-1', 120.8, 33.2);
    expect(pty.resize).toHaveBeenCalledWith(120, 33);

    manager.resize('term-1', 120, 33);
    expect(pty.resize).toHaveBeenCalledTimes(1);
  });
});
