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
  pause = vi.fn();
  resume = vi.fn();
  killSignal = vi.fn((_signal?: string) => {
    this.killed = true;
  });
  kill = this.killSignal;
  destroy = vi.fn(() => setImmediate(() => this.kill('SIGHUP')));

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

function expectNativeCleanup(pty: MockPty, times = 1): void {
  expect(pty.killSignal).toHaveBeenCalledTimes(process.platform === 'win32' ? times : 0);
  expect(pty.destroy).toHaveBeenCalledTimes(process.platform === 'win32' ? 0 : times);
}

const prompt = '\x1b]7;file://localhost/tmp\x1b\\';
const startupReady = '\x1b]777;janet-ready\x1b\\';

beforeEach(() => {
  mocks.spawnMock.mockReset();
  vi.resetModules();
});

describe('TerminalManager', () => {
  it('runs PowerShell startup commands at launch without writing them into the PTY', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create(
      'term-startup-hidden',
      undefined,
      'powershell.exe',
      () => {},
      ["Write-Output '__JANET_STARTUP_OUTPUT__'"],
    );

    const args = mocks.spawnMock.mock.calls[0][1] as string[];
    expect(args.slice(0, 3)).toEqual(['-NoLogo', '-NoExit', '-Command']);
    expect(args[3]).toMatch(/^Invoke-Expression \(\[IO\.File\]::ReadAllText\('/);
    const initPath = args[3].match(/ReadAllText\('(.+)'\)/)?.[1];
    expect(initPath).toBeDefined();
    expect(fs.readFileSync(initPath!, 'utf8')).toContain(
      "Write-Output ''__JANET_STARTUP_OUTPUT__''",
    );
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit(startupReady);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pty.write).not.toHaveBeenCalled();
    manager.cleanup();
  });

  it('keeps the largest valid PowerShell startup sequence out of the process command line', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);
    const prefix = 'Write-Output ok # ';
    const command = prefix + "'".repeat(4_096 - prefix.length);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create(
      'term-startup-max',
      undefined,
      'powershell.exe',
      () => {},
      Array(4).fill(command),
    );

    const args = mocks.spawnMock.mock.calls[0][1] as string[];
    expect(['powershell.exe', ...args].join(' ').length).toBeLessThan(32_767);
    manager.cleanup();
  });

  it('keeps launch-time startup commands isolated between local panes', async () => {
    mocks.spawnMock.mockImplementation(() => new MockPty());

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-startup-one', undefined, '/bin/zsh', () => {}, ['echo first']);
    manager.create('term-startup-two', undefined, '/bin/zsh', () => {}, ['echo second']);

    const firstEnv = mocks.spawnMock.mock.calls[0][2].env as NodeJS.ProcessEnv;
    const secondEnv = mocks.spawnMock.mock.calls[1][2].env as NodeJS.ProcessEnv;
    expect(firstEnv.ZDOTDIR).not.toBe(secondEnv.ZDOTDIR);
    expect(fs.readFileSync(path.join(firstEnv.ZDOTDIR!, '.zshrc'), 'utf8')).toContain("eval 'echo first'");
    expect(fs.readFileSync(path.join(secondEnv.ZDOTDIR!, '.zshrc'), 'utf8')).toContain("eval 'echo second'");

    manager.cleanup();
  });

  it('clears the temporary ZDOTDIR before running Zsh startup commands', async () => {
    mocks.spawnMock.mockReturnValue(new MockPty());

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-startup-nested-zsh', undefined, '/bin/zsh', () => {}, ['echo once']);

    const env = mocks.spawnMock.mock.calls[0][2].env as NodeJS.ProcessEnv;
    const zshrc = fs.readFileSync(path.join(env.ZDOTDIR!, '.zshrc'), 'utf8');
    expect(zshrc).toMatch(/^unset ZDOTDIR\n\[ -f ~\/\.zshrc \]/);
    expect(zshrc.indexOf('unset ZDOTDIR')).toBeLessThan(zshrc.indexOf("eval 'echo once'"));

    manager.cleanup();
  });

  it('runs integrated startup commands from shell init instead of PTY input', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    const commands = ['hermes doctor', 'hermes --tui'];

    manager.create('term-startup', undefined, '/bin/zsh', () => {}, commands);
    manager.create('term-startup', undefined, '/bin/zsh', () => {}, commands);

    expect(mocks.spawnMock).toHaveBeenCalledOnce();
    const zdotdir = mocks.spawnMock.mock.calls[0][2].env.ZDOTDIR as string;
    expect(fs.readFileSync(path.join(zdotdir, '.zshrc'), 'utf8'))
      .toContain("eval 'hermes doctor' && eval 'hermes --tui'");
    expect(pty.write).not.toHaveBeenCalled();
    pty.emit(prompt);
    pty.emit(prompt);
    expect(pty.write).not.toHaveBeenCalled();
    pty.emit(startupReady);
    pty.emit(startupReady);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(pty.write).not.toHaveBeenCalled();
    manager.cleanup();
  });

  it('skips startup and forwards input when a prompt hook needs an early answer', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-startup-input', undefined, '/bin/sh', () => {}, ['git pull']);

    manager.write('term-startup-input', 'echo after startup\r');
    manager.writeBinary('term-startup-input', 'x');
    expect(pty.write.mock.calls).toEqual([
      ['echo after startup\r'],
      [Buffer.from('x', 'binary')],
    ]);

    pty.emit(startupReady);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pty.write.mock.calls).toEqual([
      ['echo after startup\r'],
      [Buffer.from('x', 'binary')],
    ]);
  });

  it('forwards terminal protocol replies without cancelling pending startup', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-startup-cpr', undefined, '/bin/sh', () => {}, ['git pull']);

    manager.write('term-startup-cpr', '\x1b[1;1R', false);
    expect(pty.write).toHaveBeenCalledWith('\x1b[1;1R');

    pty.emit(startupReady);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pty.write.mock.calls).toEqual([
      ['\x1b[1;1R'],
      ["eval 'git pull'" + String.fromCharCode(13)],
    ]);
  });

  it('preserves pending startup after empty or failed user input', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);
    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-startup-failed-input', undefined, '/bin/sh', () => {}, ['git pull']);

    manager.write('term-startup-failed-input', '');
    pty.write.mockImplementationOnce(() => {
      throw new Error('native write failed');
    });
    expect(() => manager.write('term-startup-failed-input', 'x')).toThrow(/native write failed/i);
    pty.emit(startupReady);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(pty.write).toHaveBeenLastCalledWith("eval 'git pull'" + String.fromCharCode(13));
  });

  it('does not append startup commands to a partially typed user line', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-startup-partial', undefined, '/bin/sh', () => {}, ['git pull']);

    manager.write('term-startup-partial', 'ls');
    pty.emit(startupReady);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(pty.write.mock.calls).toEqual([['ls']]);
  });

  it('uses a bounded fallback when the first prompt marker never arrives', async () => {
    vi.useFakeTimers();
    try {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager();
      manager.create('term-startup-fallback', undefined, '/bin/sh', () => {}, ['hermes --tui']);

      expect(pty.write).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      manager.write('term-startup-fallback', 'q');
      expect(pty.write.mock.calls).toEqual([
        ["eval 'hermes --tui'\r"],
        ['q'],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the local startup ledger only when the pane is explicitly destroyed', async () => {
    const ptys = [new MockPty(), new MockPty()];
    mocks.spawnMock.mockImplementation(() => ptys.shift()!);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    manager.create('term-startup-recreate', undefined, '/bin/zsh', () => {}, ['first']);
    const firstZdotdir = mocks.spawnMock.mock.calls[0][2].env.ZDOTDIR as string;
    manager.destroy('term-startup-recreate');
    manager.create('term-startup-recreate', undefined, '/bin/zsh', () => {}, ['second']);
    const secondZdotdir = mocks.spawnMock.mock.calls[1][2].env.ZDOTDIR as string;

    expect(fs.readFileSync(path.join(firstZdotdir, '.zshrc'), 'utf8')).toContain("eval 'first'");
    expect(fs.readFileSync(path.join(secondZdotdir, '.zshrc'), 'utf8')).toContain("eval 'second'");
    expect(ptys.every((pty) => pty.write.mock.calls.length === 0)).toBe(true);
    manager.cleanup();
  });

  it('does not replay startup commands when a PTY exits without explicit pane destruction', async () => {
    const ptys = [new MockPty(), new MockPty()];
    mocks.spawnMock.mockImplementation(() => ptys.shift()!);

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();

    const first = manager.create('term-startup-exit', undefined, '/bin/zsh', () => {}, ['first']);
    const firstZdotdir = mocks.spawnMock.mock.calls[0][2].env.ZDOTDIR as string;
    (first as unknown as MockPty).emitExit();
    manager.create('term-startup-exit', undefined, '/bin/zsh', () => {}, ['second']);
    const secondZdotdir = mocks.spawnMock.mock.calls[1][2].env.ZDOTDIR as string;

    expect(fs.readFileSync(path.join(firstZdotdir, '.zshrc'), 'utf8')).toContain("eval 'first'");
    expect(fs.readFileSync(path.join(secondZdotdir, '.zshrc'), 'utf8')).not.toContain("eval 'second'");
    expect(ptys.every((pty) => pty.write.mock.calls.length === 0)).toBe(true);
    manager.cleanup();
  });

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

  it('replaces the onData forwarder when an existing terminal reattaches', async () => {
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

    ptys[0].emit('PS C:\\Users\\pckpr> ');

    expect(receivedA).toEqual([]);
    expect(receivedB).toEqual(['PS C:\\Users\\pckpr> ']);
  });

  it('pauses output above the high watermark and resumes after parsed output is acknowledged', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);
    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    const received: Array<{ generation: number; sequence: number }> = [];
    manager.create('term-flow', undefined, undefined, (_data, output) => received.push(output));

    pty.emit('x'.repeat(300_000));
    pty.emit('x'.repeat(224_288));

    expect(pty.pause).toHaveBeenCalledOnce();
    manager.acknowledgeOutput('term-flow', received[0].generation, received[0].sequence);
    expect(pty.resume).not.toHaveBeenCalled();
    manager.acknowledgeOutput('term-flow', received[1].generation, received[1].sequence);
    expect(pty.resume).toHaveBeenCalledOnce();
  });

  it('starts fresh flow control when an existing terminal reattaches', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);
    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    const firstOutput: Array<{ generation: number; sequence: number }> = [];
    manager.create('term-reattach-flow', undefined, undefined, (_data, output) => firstOutput.push(output));

    pty.emit('x'.repeat(600_000));
    expect(pty.pause).toHaveBeenCalledOnce();

    const currentOutput: Array<{ generation: number; sequence: number }> = [];
    manager.create('term-reattach-flow', undefined, undefined, (_data, output) => {
      currentOutput.push(output);
    });
    expect(pty.resume).toHaveBeenCalledOnce();

    pty.pause.mockClear();
    pty.emit('x'.repeat(600_000));
    expect(pty.pause).toHaveBeenCalledOnce();
    expect(currentOutput[0].generation).not.toBe(firstOutput[0].generation);
    expect(currentOutput[0].sequence).toBe(600_000);
  });

  it('does not pause output that could not be delivered to the renderer', async () => {
    const pty = new MockPty();
    mocks.spawnMock.mockReturnValue(pty);
    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager();
    manager.create('term-undelivered-flow', undefined, undefined, () => false);

    pty.emit('x'.repeat(600_000));

    expect(pty.pause).not.toHaveBeenCalled();
  });

  it('ignores output acknowledgements from a destroyed terminal generation', async () => {
    const firstPty = new MockPty();
    mocks.spawnMock.mockReturnValue(firstPty);
    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager({ platform: 'win32' });
    const firstOutput: Array<{ generation: number; sequence: number }> = [];
    manager.create('term-reused-flow', undefined, undefined, (_data, output) => firstOutput.push(output));
    firstPty.emit('x');
    manager.destroy('term-reused-flow');

    const currentPty = new MockPty();
    mocks.spawnMock.mockReturnValue(currentPty);
    const currentOutput: Array<{ generation: number; sequence: number }> = [];
    manager.create('term-reused-flow', undefined, undefined, (_data, output) => currentOutput.push(output));
    currentPty.emit('x'.repeat(600_000));
    expect(currentPty.pause).toHaveBeenCalledOnce();

    manager.acknowledgeOutput('term-reused-flow', firstOutput[0].generation, Number.MAX_SAFE_INTEGER);
    expect(currentPty.resume).not.toHaveBeenCalled();
    manager.acknowledgeOutput('term-reused-flow', currentOutput[0].generation, currentOutput[0].sequence);
    expect(currentPty.resume).toHaveBeenCalledOnce();
  });

  it('destroy() closes a Windows PTY before reusing its id', async () => {
    const ptys: MockPty[] = [];
    mocks.spawnMock.mockImplementation(() => {
      const pty = new MockPty();
      ptys.push(pty);
      return pty;
    });

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager({
      platform: 'win32',
      processInspector: processInspector([], [], [], []),
      terminateGraceMs: 0,
      forceKillGraceMs: 0,
    });

    manager.create('term-1', undefined, undefined, () => {});
    manager.destroy('term-1');
    manager.create('term-1', undefined, undefined, () => {});

    expect(mocks.spawnMock).toHaveBeenCalledTimes(2);
    expect(ptys[0].killed).toBe(true);
  });

  it('does not signal a reused POSIX PTY root during pane destruction', async () => {
    const firstPty = new MockPty();
    const ptys = [firstPty, new MockPty()];
    mocks.spawnMock.mockImplementation(() => ptys.shift()!);
    const original = processInfo(firstPty.pid, 1, 'zsh', { startTime: '1' });
    const reused = processInfo(firstPty.pid, 1, 'zsh', { startTime: '2' });
    const killProcess = vi.fn();

    const { TerminalManager } = await loadTerminalManager();
    const manager = new TerminalManager({
      platform: 'linux',
      processInspector: processInspector([original], [reused], [], []),
      terminateGraceMs: 0,
      forceKillGraceMs: 0,
      killProcess,
    });
    manager.create('term-reused-destroy', undefined, '/bin/zsh', () => {});

    manager.destroy('term-reused-destroy');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(killProcess).not.toHaveBeenCalled();
    expect(firstPty.killSignal).not.toHaveBeenCalled();
    expect(firstPty.destroy).toHaveBeenCalledOnce();
    expect(() => manager.create('term-reused-destroy', undefined, '/bin/zsh', () => {})).not.toThrow();
    expect(mocks.spawnMock).toHaveBeenCalledTimes(2);
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
    manager.resize('term-1', 0.5, 24);
    manager.resize('term-1', 80, 0.5);
    manager.resize('term-1', 1_001, 24);
    manager.resize('term-1', 80, 1_001);
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

  describe('stopAll()', () => {
    it('does not inject Ctrl+C into an idle shell during shutdown', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector([shell], [shell], [], []),
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
      });
      manager.create('term-idle-stop', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(pty.write).not.toHaveBeenCalled();
      expectNativeCleanup(pty);
    });

    it('terminates stable descendants deepest-first and kills the PTY root', async () => {
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
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-stop', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(pty.write).not.toHaveBeenCalled();
      expect(killProcess.mock.calls).toEqual([
        [5002, 'SIGTERM'],
        [5001, 'SIGTERM'],
      ]);
      expectNativeCleanup(pty);
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
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-stop-a', undefined, '/bin/zsh', () => {});
      manager.create('term-stop-b', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).resolves.toBeUndefined();
      expect(killProcess).toHaveBeenCalledWith(5001, 'SIGTERM');
      expect(killProcess).toHaveBeenCalledWith(5002, 'SIGTERM');
      expectNativeCleanup(firstPty);
      expectNativeCleanup(secondPty);
    });

    it('keeps ownership of a child that reparents between process snapshots', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const attached = processInfo(5008, pty.pid, 'node', { startTime: '2' });
      const reparented = processInfo(5008, 1, 'node', { startTime: '2' });
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector([shell, attached], [shell, reparented], [], []),
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-reparent', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(killProcess).toHaveBeenCalledWith(5008, 'SIGTERM');
      expectNativeCleanup(pty);
    });

    it('does not signal a descendant pid reused between shutdown snapshots', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const original = processInfo(5008, pty.pid, 'node', { startTime: '2' });
      const reused = processInfo(5008, pty.pid, 'node', { startTime: '3' });
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector([shell, original], [shell, reused], [], []),
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-reused-descendant', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(killProcess).not.toHaveBeenCalledWith(5008, expect.anything());
      expectNativeCleanup(pty);
    });

    it('does not force-kill a descendant pid reused after graceful termination', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const original = processInfo(5008, pty.pid, 'node', { startTime: '2' });
      const reused = processInfo(5008, pty.pid, 'node', { startTime: '3' });
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector(
          [shell, original],
          [shell, original],
          [shell, reused],
          [],
        ),
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-reused-after-term', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(killProcess).toHaveBeenCalledWith(5008, 'SIGTERM');
      expect(killProcess).not.toHaveBeenCalledWith(5008, 'SIGKILL');
      expectNativeCleanup(pty);
    });

    it('does not signal a reused POSIX PTY root through native cleanup', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const original = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const reused = processInfo(pty.pid, 1, 'zsh', { startTime: '2' });
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        platform: 'linux',
        processInspector: processInspector([original], [original], [reused], []),
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-reused-root', undefined, '/bin/zsh', () => {});

      await manager.stopAll();

      expect(killProcess).not.toHaveBeenCalledWith(pty.pid, 'SIGKILL');
      expect(pty.killSignal).not.toHaveBeenCalled();
      expect(pty.destroy).toHaveBeenCalledOnce();
    });

    it('retains a reparented process after identity verification fails until it disappears', async () => {
      const pty = new MockPty();
      mocks.spawnMock.mockReturnValue(pty);
      const unidentifiedShell = processInfo(pty.pid, 1, 'zsh');
      const unidentifiedAttached = processInfo(5008, pty.pid, 'node');
      const unidentifiedReparented = processInfo(5008, 1, 'node');
      const shell = processInfo(pty.pid, 1, 'zsh', { startTime: '1' });
      const reparented = processInfo(5008, 1, 'node', { startTime: '2' });
      const killProcess = vi.fn();

      const { TerminalManager } = await loadTerminalManager();
      const manager = new TerminalManager({
        processInspector: processInspector(
          [unidentifiedShell, unidentifiedAttached],
          [unidentifiedShell, unidentifiedReparented],
          [shell, reparented],
          [],
          [],
          [],
          [],
        ),
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-reparent-no-start-time', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).rejects.toThrow(/identity.*unverifiable/i);
      expect(killProcess).not.toHaveBeenCalled();
      expect(pty.kill).not.toHaveBeenCalled();

      manager.write('term-reparent-no-start-time', 'still-owned');
      await expect(manager.stopAll()).rejects.toThrow(/identity.*unverifiable/i);
      expect(killProcess).not.toHaveBeenCalled();
      expect(pty.kill).not.toHaveBeenCalled();

      manager.write('term-reparent-no-start-time', 'still-owned-after-reparent');
      await expect(manager.stopAll()).resolves.toBeUndefined();

      expect(killProcess).not.toHaveBeenCalled();
      expectNativeCleanup(pty);
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
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-stubborn', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).rejects.toThrow(/did not stop.*node \(5007\)/i);
      expect(killProcess.mock.calls).toContainEqual([5007, 'SIGTERM']);
      expect(killProcess.mock.calls).toContainEqual([5007, 'SIGKILL']);
      expect(killProcess.mock.calls).toContainEqual([pty.pid, 'SIGKILL']);
      expectNativeCleanup(pty);

      await expect(manager.stopAll()).rejects.toThrow(/did not stop.*node \(5007\)/i);
      expectNativeCleanup(pty, 2);
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
        terminateGraceMs: 0,
        forceKillGraceMs: 0,
        killProcess,
      });
      manager.create('term-ledger-retry', undefined, '/bin/zsh', () => {});

      await expect(manager.stopAll()).rejects.toThrow(/node \(5009\)/i);
      pty.emitExit();
      await expect(manager.stopAll()).resolves.toBeUndefined();

      expect(killProcess.mock.calls.filter(([pid, signal]) => pid === 5009 && signal === 'SIGTERM')).toHaveLength(2);
    });
  });
});
