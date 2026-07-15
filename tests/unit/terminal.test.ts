import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessInfo, ProcessInspector } from '../../src/main/processInspector';

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

  /** Test helper: simulate the pty process exiting. */
  emitExit(event = { exitCode: 0, signal: 0 }) {
    for (const cb of this.onExitCallbacks) cb(event);
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

function processInfo(
  pid: number,
  ppid: number,
  name: string,
  overrides: Partial<ProcessInfo> = {},
): ProcessInfo {
  return { pid, ppid, name, ...overrides };
}

function processInspector(...snapshots: Array<ProcessInfo[] | Error>): ProcessInspector {
  let index = 0;
  return {
    snapshot: vi.fn(async () => {
      const next = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

const prompt = '\x1b]7;file://localhost/tmp\x1b\\';

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

  describe('listRunningWork()', () => {
    it('does not report an idle interactive shell as running work', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const inspector = processInspector([shell], [shell]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-idle', undefined, '/bin/zsh', () => {});

      await expect(manager.listRunningWork()).resolves.toEqual([]);
    });

    it('does not treat partially typed input as a running command when inspection fails', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const inspector = processInspector(new Error('process table unavailable'));

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-partial', undefined, '/bin/zsh', () => {});
      manager.write('term-partial', 'npm run dev');

      await expect(manager.listRunningWork()).resolves.toEqual([]);
    });

    it('reports a stable foreground child after a command is submitted', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const server = processInfo(5001, pty.pid, 'node', { startTime: '2' });
      const inspector = processInspector([shell, server], [shell, server]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-foreground', '/workspace/api', '/bin/zsh', () => {});
      manager.write('term-foreground', 'node server.js\r');

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({
          terminalId: 'term-foreground',
          rootPid: pty.pid,
          processName: 'node',
          kind: 'foreground',
          descendantPids: [5001],
        }),
      ]);
    });

    it('reports a stable background child after the shell prompt returns', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const server = processInfo(5002, pty.pid, 'python', { startTime: '2' });
      const inspector = processInspector([shell, server], [shell, server]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-background', '/workspace/api', '/bin/zsh', () => {});
      manager.write('term-background', 'python -m http.server &\r');
      pty.emit(prompt);

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({
          terminalId: 'term-background',
          rootPid: pty.pid,
          processName: 'python',
          kind: 'background',
          descendantPids: [5002],
        }),
      ]);
    });

    it('excludes a child that disappears between process-table snapshots', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const transient = processInfo(5003, pty.pid, 'git', { startTime: '2' });
      const inspector = processInspector([shell, transient], [shell]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-transient', undefined, '/bin/zsh', () => {});
      manager.write('term-transient', 'git status\r');
      pty.emit(prompt);

      await expect(manager.listRunningWork()).resolves.toEqual([]);
    });

    it('ignores stable zombie descendants', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const zombie = processInfo(5004, pty.pid, 'node', { startTime: '2', state: 'Z' });
      const inspector = processInspector([shell, zombie], [shell, zombie]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-zombie', undefined, '/bin/zsh', () => {});

      await expect(manager.listRunningWork()).resolves.toEqual([]);
    });

    it('ignores a nested interactive shell that has no non-shell descendants', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const nestedShell = processInfo(5005, pty.pid, 'bash', { startTime: '2' });
      const inspector = processInspector([shell, nestedShell], [shell, nestedShell]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-nested-shell', undefined, '/bin/zsh', () => {});
      manager.write('term-nested-shell', 'bash\r');
      pty.emit(prompt);

      await expect(manager.listRunningWork()).resolves.toEqual([]);
    });

    it('detects a service that starts between close-time process samples', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const server = processInfo(5006, pty.pid, 'node', { startTime: '2' });
      const inspector = processInspector([shell], [shell, server], [shell, server]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({ processInspector: inspector, sampleDelayMs: 0 });
      manager.create('term-starting', undefined, '/bin/zsh', () => {});
      manager.write('term-starting', 'node server.js &\r');
      pty.emit(prompt);

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({ terminalId: 'term-starting', processName: 'node' }),
      ]);
      expect(inspector.snapshot).toHaveBeenCalledTimes(3);
    });

    it('reports a shell process that was replaced in-place with exec', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const replacement = processInfo(pty.pid, 1, 'node', { startTime: '1' });
      const inspector = processInspector([replacement], [replacement]);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-exec', undefined, '/bin/zsh', () => {});
      manager.write('term-exec', 'exec node server.js\r');

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({
          terminalId: 'term-exec',
          rootPid: pty.pid,
          processName: 'node',
          kind: 'foreground',
        }),
      ]);
    });

    it('reports unknown work when process inspection fails after a command starts', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const inspector = processInspector(new Error('process table unavailable'));

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-unknown', '/workspace/api', '/bin/zsh', () => {});
      manager.write('term-unknown', 'npm run dev\r');

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({
          terminalId: 'term-unknown',
          rootPid: pty.pid,
          kind: 'unknown',
          descendantPids: [],
        }),
      ]);
    });

    it('fails safely after a submitted command returns to a prompt when inspection is unavailable', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const inspector = processInspector(new Error('process table unavailable'));

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({ processInspector: inspector, sampleDelayMs: 0 });
      manager.create('term-unknown-background', '/workspace/api', '/bin/zsh', () => {});
      manager.write('term-unknown-background', 'node server.js &\r');
      pty.emit(prompt);

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({
          terminalId: 'term-unknown-background',
          kind: 'unknown',
        }),
      ]);
    });

    it('removes an exited pty from running-work detection', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const inspector = processInspector(new Error('process table unavailable'));

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        sampleDelayMs: 0,
        sleep: vi.fn().mockResolvedValue(undefined),
      });
      manager.create('term-exited', undefined, '/bin/zsh', () => {});
      manager.write('term-exited', 'npm run dev\r');
      pty.emitExit();

      await expect(manager.listRunningWork()).resolves.toEqual([]);
      expect(inspector.snapshot).not.toHaveBeenCalled();
    });

    it('interrupts work, terminates stable descendants deepest-first, and kills the PTY root', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const runner = processInfo(5001, pty.pid, 'npm', { startTime: '2' });
      const server = processInfo(5002, runner.pid, 'node', { startTime: '3' });
      const snapshot = [shell, runner, server];
      const inspector = processInspector(snapshot, snapshot, [], []);
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        stopGraceMs: 0,
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-stop', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(pty.write).toHaveBeenCalledWith('\x03');
      expect(killProcess.mock.calls).toEqual([
        [5002, 'SIGTERM'],
        [5001, 'SIGTERM'],
      ]);
      expect(pty.kill).toHaveBeenCalledOnce();
      await expect(manager.listRunningWork()).resolves.toEqual([]);
    });

    it('continues stopping other terminals when one descendant termination fails', async () => {
      const firstPty = new MockPty();
      const secondPty = new MockPty();
      secondPty.pid = 4243;
      mocks.spawnMock.mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
      const snapshot = [
        processInfo(firstPty.pid, 1, 'zsh', { startTime: '1' }),
        processInfo(5001, firstPty.pid, 'node', { startTime: '2' }),
        processInfo(secondPty.pid, 1, 'zsh', { startTime: '3' }),
        processInfo(5002, secondPty.pid, 'python', { startTime: '4' }),
      ];
      const killProcess = vi.fn((pid: number) => {
        if (pid === 5001) throw new Error('already exited');
      });

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector(snapshot, snapshot, [], []),
        stopGraceMs: 0,
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-stop-a', undefined, '/bin/zsh', () => {});
      manager.create('term-stop-b', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).resolves.toBeUndefined();
      expect(killProcess).toHaveBeenCalledWith(5001, 'SIGTERM');
      expect(killProcess).toHaveBeenCalledWith(5002, 'SIGTERM');
      expect(firstPty.kill).toHaveBeenCalledOnce();
      expect(secondPty.kill).toHaveBeenCalledOnce();
    });

    it('keeps ownership of a child that reparents during the interrupt grace period', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const attached = processInfo(5008, pty.pid, 'node', { startTime: '2' });
      const reparented = processInfo(5008, 1, 'node', { startTime: '2' });
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector([shell, attached], [shell, reparented], [], []),
        stopGraceMs: 0,
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-reparent', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(killProcess).toHaveBeenCalledWith(5008, 'SIGTERM');
      expect(pty.kill).toHaveBeenCalledOnce();
    });

    it('escalates stubborn descendants and rejects shutdown if they survive', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const server = processInfo(5007, pty.pid, 'node', { startTime: '2' });
      const snapshot = [shell, server];
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector(snapshot, snapshot, snapshot, snapshot),
        stopGraceMs: 0,
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-stubborn', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).rejects.toThrow(/did not stop.*node \(5007\)/i);
      expect(killProcess.mock.calls).toContainEqual([5007, 'SIGTERM']);
      expect(killProcess.mock.calls).toContainEqual([5007, 'SIGKILL']);
      expect(killProcess.mock.calls).toContainEqual([pty.pid, 'SIGKILL']);
      expect(pty.kill).toHaveBeenCalledOnce();

      await expect(manager.listRunningWork()).resolves.toEqual([
        expect.objectContaining({ processName: 'node', descendantPids: [5007] }),
      ]);
      await expect(manager.stopAll()).rejects.toThrow(/did not stop.*node \(5007\)/i);
      expect(pty.kill).toHaveBeenCalledTimes(2);
    });

    it('retries a remembered survivor after its PTY root exits and the child reparents', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const attached = processInfo(5009, pty.pid, 'node', { startTime: '2' });
      const reparented = processInfo(5009, 1, 'node', { startTime: '2' });
      const inspector = processInspector(
        [shell, attached],
        [shell, reparented],
        [shell, reparented],
        [reparented],
        [reparented],
        [reparented],
        [reparented],
        [],
        [],
      );
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: inspector,
        stopGraceMs: 0,
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-ledger-retry', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).rejects.toThrow(/node \(5009\)/i);
      pty.emitExit();
      await expect(manager.stopAll()).resolves.toBeUndefined();

      await expect(manager.listRunningWork()).resolves.toEqual([]);
      expect(killProcess.mock.calls.filter(([pid, signal]) => pid === 5009 && signal === 'SIGTERM')).toHaveLength(2);
    });
  });
});
