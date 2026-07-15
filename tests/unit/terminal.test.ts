import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

class MockPty {
  pid = 4242;
  onDataCallbacks: Array<(data: string) => void> = [];
  onExitCallbacks: Array<(event: { exitCode: number; signal: number }) => void> = [];
  killed = false;

  onData(cb: (data: string) => void) {
    this.onDataCallbacks.push(cb);
    return { dispose: vi.fn() };
  }

  onExit(cb: (event: { exitCode: number; signal: number }) => void) {
    this.onExitCallbacks.push(cb);
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

  it('expands a leading tilde in cwd before spawning the shell', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-home', '~/projects/janet', '/bin/zsh', () => {});

    expect(mocks.spawnMock).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-i'],
      expect.objectContaining({
        cwd: `${os.homedir()}${path.sep}projects${path.sep}janet`,
      }),
    );
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
          ZDOTDIR: expect.stringContaining('janet-shell-init-'),
          SHELL: '/bin/zsh',
        }),
      }),
    );
    expect(mocks.spawnMock.mock.calls[0][2].env).not.toHaveProperty('JANET_KITTY_GRAPHICS');
    const zdotdir = mocks.spawnMock.mock.calls[0][2].env.ZDOTDIR as string;
    expect(path.dirname(zdotdir)).toBe(path.resolve(os.tmpdir()));
    expect(fs.existsSync(path.join(zdotdir, '.zshrc'))).toBe(true);
    if (process.platform !== 'win32') {
      expect(fs.statSync(zdotdir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(zdotdir, '.zshrc')).mode & 0o777).toBe(0o600);
    }
    manager.cleanup();
    expect(fs.existsSync(zdotdir)).toBe(false);
  });

  it('does not inherit another terminal emulator\'s graphics capabilities', async () => {
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('KITTY_WINDOW_ID', '77');
    vi.stubEnv('WEZTERM_PANE', '8');
    vi.stubEnv('ITERM_SESSION_ID', 'w0t0p0');
    vi.stubEnv('TMUX', '/tmp/tmux-parent,1,0');
    vi.stubEnv('TMUX_PANE', '%1');
    vi.stubEnv('STY', '123.parent');
    try {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const { TerminalManager } = await loadTerminalManager();
      new TerminalManager().create('term-clean-env', undefined, '/bin/zsh', () => {});

      const env = mocks.spawnMock.mock.calls[0][2].env;
      expect(env).toMatchObject({ TERM: 'xterm-256color', TERM_PROGRAM: 'JaneT' });
      expect(env).not.toHaveProperty('KITTY_WINDOW_ID');
      expect(env).not.toHaveProperty('WEZTERM_PANE');
      expect(env).not.toHaveProperty('ITERM_SESSION_ID');
      expect(env).not.toHaveProperty('JANET_KITTY_GRAPHICS');
      expect(env).not.toHaveProperty('TMUX');
      expect(env).not.toHaveProperty('TMUX_PANE');
      expect(env).not.toHaveProperty('STY');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts bash with --rcfile so PROMPT_COMMAND lives in the interactive shell', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-bash', undefined, 'bash', () => {});

    const args = mocks.spawnMock.mock.calls[0][1] as string[];
    expect(args[0]).toBe('--rcfile');
    expect(args[2]).toBe('-i');
    expect(path.dirname(path.dirname(args[1]))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(path.dirname(args[1]))).toMatch(/^janet-shell-init-/);
    expect(path.basename(args[1])).toBe('bashrc');
    expect(fs.existsSync(args[1])).toBe(true);
    const initDir = path.dirname(args[1]);
    manager.cleanup();
    expect(fs.existsSync(initDir)).toBe(false);
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

  it('writes xterm binary input as a Buffer to preserve legacy mouse reports', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);
    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-binary', undefined, undefined, () => {});
    manager.writeBinary('term-binary', '\xff\x00');

    expect(pty.write).toHaveBeenCalledWith(Buffer.from('\xff\x00', 'binary'));
  });
});
