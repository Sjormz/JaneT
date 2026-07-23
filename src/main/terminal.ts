import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, IPty } from 'node-pty';
import { buildShellInit, STARTUP_READY_MARKER } from './shell-init';
import { compileStartupCommands, inferStartupShellDialect } from '../shared/startupCommands';
import {
  ProcessInfo,
  ProcessInspector,
  stableProcesses,
  SystemProcessInspector,
} from './processInspector';

interface TerminalInstance {
  pty: IPty;
  id: string;
  /** The first renderer forwarder registered for this PTY. */
  forwardData?: (data: string) => void;
  cols: number;
  rows: number;
  promptMarkerTail: string;
  startupExpression?: string;
  startupTimer?: ReturnType<typeof setTimeout>;
}

export interface TerminalManagerOptions {
  processInspector?: ProcessInspector;
  sleep?: (milliseconds: number) => Promise<void>;
  stopGraceMs?: number;
  terminateGraceMs?: number;
  forceKillGraceMs?: number;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_STOP_GRACE_MS = 300;
const DEFAULT_TERMINATE_GRACE_MS = 750;
const DEFAULT_FORCE_KILL_GRACE_MS = 250;
const STARTUP_COMMAND_FALLBACK_MS = 1_000;
const PROMPT_PROBE_TAIL_LENGTH = STARTUP_READY_MARKER.length - 1;

const SHELL_PROCESS_NAMES = new Set([
  'bash', 'cmd', 'dash', 'fish', 'ksh', 'nu', 'nushell', 'powershell', 'pwsh', 'sh', 'tcsh', 'zsh',
]);

function processName(name: string): string {
  const leaf = name.replace(/\\/g, '/').split('/').pop() || name;
  return leaf.toLowerCase().replace(/^-+/, '').replace(/\.exe$/i, '');
}

function processIdentityKey(process: ProcessInfo): string {
  return process.startTime
    ? `${process.pid}:${process.startTime}`
    : `${process.pid}:${process.name.toLowerCase()}`;
}

function isShellProcess(name: string): boolean {
  return SHELL_PROCESS_NAMES.has(processName(name));
}

function descendantsOf(processes: ProcessInfo[], rootPid: number): ProcessInfo[] {
  const children = new Map<number, ProcessInfo[]>();
  for (const process of processes) {
    if (process.state?.toUpperCase().startsWith('Z')) continue;
    const siblings = children.get(process.ppid) ?? [];
    siblings.push(process);
    children.set(process.ppid, siblings);
  }

  const descendants: ProcessInfo[] = [];
  const pending = [...(children.get(rootPid) ?? [])];
  const visited = new Set<number>([rootPid]);
  while (pending.length > 0) {
    const process = pending.shift()!;
    if (visited.has(process.pid)) continue;
    visited.add(process.pid);
    descendants.push(process);
    pending.push(...(children.get(process.pid) ?? []));
  }
  return descendants;
}

function resolveTerminalCwd(cwd?: string): string {
  if (!cwd) return os.homedir();
  const trimmed = cwd.trim();
  if (!trimmed || trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

type ShellInitFile = (name: string, contents: string) => string;

function shellLaunch(shell: string, init: string, initFile: ShellInitFile): { args: string[]; env: NodeJS.ProcessEnv } {
  if (!init) return { args: [], env: {} };

  const base = path.basename(shell).toLowerCase();
  if (base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe') {
    return { args: ['-NoLogo', '-NoExit', '-Command', init], env: {} };
  }

  if (base === 'bash' || base === 'bash.exe') {
    const rcfile = initFile('bashrc', `[ -f ~/.bashrc ] && . ~/.bashrc\n${init}\n`);
    return { args: ['--rcfile', rcfile, '-i'], env: {} };
  }

  if (base === 'zsh' || base === 'zsh.exe') {
    const zshrc = initFile('.zshrc', `[ -f ~/.zshrc ] && . ~/.zshrc\n${init}\n`);
    const zdotdir = path.dirname(zshrc);
    return { args: ['-i'], env: { ZDOTDIR: zdotdir } };
  }

  if (base === 'fish' || base === 'fish.exe') {
    return { args: ['--init-command', init], env: {} };
  }

  return { args: [], env: {} };
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map();
  private pendingStopProcesses: Map<string, ProcessInfo> = new Map();
  private startupCommandLedger = new Set<string>();
  private shellInitDir: string | null = null;
  private readonly processInspector: ProcessInspector;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly stopGraceMs: number;
  private readonly terminateGraceMs: number;
  private readonly forceKillGraceMs: number;
  private readonly killProcess: (pid: number, signal: NodeJS.Signals) => void;

  constructor(options: TerminalManagerOptions = {}) {
    this.processInspector = options.processInspector ?? new SystemProcessInspector();
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.stopGraceMs = Math.max(0, options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS);
    this.terminateGraceMs = Math.max(0, options.terminateGraceMs ?? DEFAULT_TERMINATE_GRACE_MS);
    this.forceKillGraceMs = Math.max(0, options.forceKillGraceMs ?? DEFAULT_FORCE_KILL_GRACE_MS);
    this.killProcess = options.killProcess ?? ((pid, signal) => process.kill(pid, signal));
  }

  /**
   * Create (or reuse) the pty for `id`, and register `onData` as its
   * single output forwarder.
   *
   * Both parts of this are idempotent by id. React 18 StrictMode
   * double-invokes mount effects in dev (mount -> cleanup -> mount)
   * before the first `terminal:create` IPC round-trip resolves, so this
   * can legitimately be called twice in quick succession for the same
   * termId. Without these guards we'd either spawn a second real shell
   * process, or attach a second onData forwarder to the same already-live
   * pty — either way the renderer ends up with two streams of output
   * landing on one xterm instance, which is what produced the "PS
   * C:\...> PS C:\...>" duplicate-prompt bug. Reusing the existing pty
   * and only ever wiring onData once fixes both.
   */
  create(
    id: string,
    cwd?: string,
    shell?: string,
    onData?: (data: string) => void,
    startupCommands?: unknown,
  ): IPty {
    const existing = this.terminals.get(id);
    if (existing) {
      if (onData && !existing.forwardData) existing.forwardData = onData;
      return existing.pty;
    }

    const defaultShell = shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
    const defaultCwd = resolveTerminalCwd(cwd);
    const startupDialect = inferStartupShellDialect(defaultShell);
    const startupExpression = startupDialect
      ? compileStartupCommands(startupCommands, startupDialect)
      : '';

    const init = buildShellInit(defaultShell);

    const launch = shellLaunch(defaultShell, init, (name, contents) => this.ensureShellInitFile(name, contents));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'JaneT',
      COLORTERM: 'truecolor',
      ...launch.env,
      // Ensure shells that key on these (some readline configs) stay
      // in their interactive mode.
      SHELL: defaultShell,
    };
    // The Hermes graphics opt-in is applied only by the direct-shell wrapper
    // in shell-init.ts. Keeping it out of the PTY environment prevents it from
    // leaking into nested tmux/screen sessions that may not pass Kitty APCs.
    delete env.JANET_KITTY_GRAPHICS;
    // JaneT may itself have been launched from another terminal. Do not leak
    // that parent's graphics capabilities into this independent PTY: Hermes
    // (and similar tools) would otherwise mis-detect Kitty/iTerm/WezTerm even
    // after the JaneT-specific opt-in is removed inside a multiplexer.
    delete env.KITTY_WINDOW_ID;
    delete env.WEZTERM_PANE;
    delete env.ITERM_SESSION_ID;
    // A JaneT PTY is also a fresh terminal boundary even if the Electron app
    // was launched from a tmux/screen shell. Nested multiplexers created inside
    // this PTY will set their own fresh markers.
    delete env.TMUX;
    delete env.TMUX_PANE;
    delete env.STY;

    const pty = spawn(defaultShell, launch.args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: defaultCwd,
      env,
    });

    const terminal: TerminalInstance = {
      pty,
      id,
      forwardData: onData,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      promptMarkerTail: '',
      ...(startupExpression && !this.startupCommandLedger.has(id) ? { startupExpression } : {}),
    };
    this.terminals.set(id, terminal);
    pty.onExit(() => {
      const current = this.terminals.get(id);
      if (current?.pty === pty) {
        if (current.startupTimer) clearTimeout(current.startupTimer);
        this.terminals.delete(id);
      }
    });
    pty.onData((data) => {
      const current = this.terminals.get(id);
      if (current?.pty !== pty) return;
      const promptProbe = current.promptMarkerTail + data;
      const reachedStartupReady = promptProbe.includes(STARTUP_READY_MARKER);
      current.promptMarkerTail = promptProbe.slice(-PROMPT_PROBE_TAIL_LENGTH);
      current.forwardData?.(data);
      if (reachedStartupReady) {
        setImmediate(() => this.dispatchStartupCommands(current));
      }
    });
    // Integrated shells emit a real prompt marker after the user's profile
    // finishes. Never bypass that signal: a slow profile may itself read
    // stdin. The bounded timer is only for recognized shells that JaneT
    // cannot instrument (for example sh variants).
    if (terminal.startupExpression && !init) {
      terminal.startupTimer = setTimeout(() => {
        this.dispatchStartupCommands(terminal);
      }, STARTUP_COMMAND_FALLBACK_MS);
      terminal.startupTimer.unref?.();
    }
    return pty;
  }

  resize(id: string, cols: number, rows: number): void {
    const term = this.terminals.get(id);
    if (!term) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return;
    const nextCols = Math.floor(cols);
    const nextRows = Math.floor(rows);
    if (term.cols === nextCols && term.rows === nextRows) return;
    try {
      term.pty.resize(nextCols, nextRows);
      term.cols = nextCols;
      term.rows = nextRows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('EBADF')) {
        this.terminals.delete(id);
        return;
      }
      throw error;
    }
  }

  write(id: string, data: string, userInput = true): void {
    const term = this.terminals.get(id);
    if (term) {
      if (userInput && term.startupExpression && !this.startupCommandLedger.has(id)) {
        this.cancelStartupCommands(term);
      }
      term.pty.write(data);
    }
  }

  writeBinary(id: string, data: string, userInput = true): void {
    const term = this.terminals.get(id);
    if (term) {
      const binary = Buffer.from(data, 'binary');
      if (userInput && term.startupExpression && !this.startupCommandLedger.has(id)) {
        this.cancelStartupCommands(term);
      }
      term.pty.write(binary);
    }
  }

  async stopAll(): Promise<void> {
    const terminals = Array.from(this.terminals.values());
    const pendingStopProcesses = Array.from(this.pendingStopProcesses.values());
    if (terminals.length === 0 && pendingStopProcesses.length === 0) {
      this.cleanup();
      return;
    }

    let before: ProcessInfo[];
    try {
      before = await this.processInspector.snapshot();
    } catch (error) {
      throw new Error(`Could not inspect local processes before stopping them: ${error instanceof Error ? error.message : String(error)}`);
    }

    const rootPids = new Set(terminals.map((terminal) => terminal.pty.pid));
    const tracked = new Map<string, ProcessInfo>();
    const track = (processes: ProcessInfo[]) => {
      for (const process of processes) tracked.set(processIdentityKey(process), process);
    };
    const pendingNow = stableProcesses(pendingStopProcesses, before)
      .filter((process) => !process.state?.toUpperCase().startsWith('Z'));
    this.pendingStopProcesses.clear();
    track(pendingNow);
    for (const terminal of terminals) {
      const root = before.find((process) => process.pid === terminal.pty.pid);
      if (root) track([root]);
      track(descendantsOf(before, terminal.pty.pid));
      try { terminal.pty.write('\x03'); } catch {}
    }
    if (this.stopGraceMs > 0) await this.sleep(this.stopGraceMs);

    let afterInterrupt: ProcessInfo[];
    try {
      afterInterrupt = await this.processInspector.snapshot();
    } catch (error) {
      this.rememberPendingStops(Array.from(tracked.values()));
      throw new Error(`Could not verify local processes after interrupting them: ${error instanceof Error ? error.message : String(error)}`);
    }

    const terminateTargets = new Map<string, ProcessInfo>();
    for (const terminal of terminals) {
      const root = afterInterrupt.find((process) => process.pid === terminal.pty.pid);
      if (root) track([root]);
      const descendants = descendantsOf(afterInterrupt, terminal.pty.pid).reverse();
      track(descendants);
      for (const descendant of descendants) {
        terminateTargets.set(processIdentityKey(descendant), descendant);
      }
    }
    const stillTracked = stableProcesses(Array.from(tracked.values()), afterInterrupt);
    for (const process of stillTracked) {
      if ((!rootPids.has(process.pid) || !isShellProcess(process.name)) && !terminateTargets.has(processIdentityKey(process))) {
        terminateTargets.set(processIdentityKey(process), process);
      }
    }
    for (const process of terminateTargets.values()) {
      try { this.killProcess(process.pid, 'SIGTERM'); } catch {}
    }
    if (this.terminateGraceMs > 0) await this.sleep(this.terminateGraceMs);

    let afterTerminate: ProcessInfo[];
    try {
      afterTerminate = await this.processInspector.snapshot();
    } catch (error) {
      this.rememberPendingStops(Array.from(tracked.values()));
      throw new Error(`Could not verify local processes after terminating them: ${error instanceof Error ? error.message : String(error)}`);
    }

    const forceTargets = new Map<string, ProcessInfo>();
    for (const process of stableProcesses(Array.from(tracked.values()), afterTerminate)) {
      forceTargets.set(processIdentityKey(process), process);
    }
    for (const terminal of terminals) {
      const root = afterTerminate.find((process) => process.pid === terminal.pty.pid);
      if (root) {
        track([root]);
        forceTargets.set(processIdentityKey(root), root);
      }
      for (const descendant of descendantsOf(afterTerminate, terminal.pty.pid).reverse()) {
        track([descendant]);
        forceTargets.set(processIdentityKey(descendant), descendant);
      }
    }
    track(Array.from(forceTargets.values()));
    for (const process of forceTargets.values()) {
      try { this.killProcess(process.pid, 'SIGKILL'); } catch {}
    }

    for (const terminal of terminals) {
      try { terminal.pty.kill(); } catch {}
    }
    if (this.forceKillGraceMs > 0) await this.sleep(this.forceKillGraceMs);

    let finalSnapshot: ProcessInfo[];
    try {
      finalSnapshot = await this.processInspector.snapshot();
    } catch (error) {
      this.rememberPendingStops(Array.from(tracked.values()));
      throw new Error(`Could not verify that local processes stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
    let remaining = stableProcesses(Array.from(tracked.values()), finalSnapshot)
      .filter((process) => !process.state?.toUpperCase().startsWith('Z'));
    if (remaining.length > 0) {
      for (const process of remaining) {
        try { this.killProcess(process.pid, 'SIGKILL'); } catch {}
      }
      if (this.forceKillGraceMs > 0) await this.sleep(this.forceKillGraceMs);
      let verificationSnapshot: ProcessInfo[];
      try {
        verificationSnapshot = await this.processInspector.snapshot();
      } catch (error) {
        this.rememberPendingStops(remaining);
        throw new Error(`Could not verify force-killed local processes: ${error instanceof Error ? error.message : String(error)}`);
      }
      remaining = stableProcesses(remaining, verificationSnapshot)
        .filter((process) => !process.state?.toUpperCase().startsWith('Z'));
    }
    if (remaining.length > 0) {
      this.pendingStopProcesses.clear();
      this.rememberPendingStops(remaining);
      throw new Error(`These local processes did not stop: ${remaining.map((process) => `${process.name} (${process.pid})`).join(', ')}`);
    }
    this.pendingStopProcesses.clear();
    for (const terminal of terminals) {
      if (this.terminals.get(terminal.id) === terminal) this.terminals.delete(terminal.id);
    }
    this.cleanup();
  }

  destroy(id: string): void {
    const term = this.terminals.get(id);
    if (term) {
      if (term.startupTimer) clearTimeout(term.startupTimer);
      try { term.pty.kill(); } catch {}
      this.terminals.delete(id);
    }
    this.startupCommandLedger.delete(id);
  }

  cleanup(): void {
    for (const [id] of this.terminals) {
      this.destroy(id);
    }
    this.startupCommandLedger.clear();
    if (this.shellInitDir) {
      try { fs.rmSync(this.shellInitDir, { recursive: true, force: true }); } catch {}
      this.shellInitDir = null;
    }
  }

  private rememberPendingStops(processes: ProcessInfo[]): void {
    for (const process of processes) {
      if (process.state?.toUpperCase().startsWith('Z')) continue;
      this.pendingStopProcesses.set(processIdentityKey(process), process);
    }
  }

  private dispatchStartupCommands(terminal: TerminalInstance): void {
    if (
      this.terminals.get(terminal.id) !== terminal ||
      !terminal.startupExpression ||
      this.startupCommandLedger.has(terminal.id)
    ) return;

    const startupExpression = terminal.startupExpression;
    this.startupCommandLedger.add(terminal.id);
    terminal.startupExpression = undefined;
    if (terminal.startupTimer) {
      clearTimeout(terminal.startupTimer);
      terminal.startupTimer = undefined;
    }
    try {
      terminal.pty.write(`${startupExpression}\r`);
    } catch {
      // The PTY may have exited between readiness detection and the write.
      // This still counts as the pane's single automatic startup attempt.
    }
  }

  private cancelStartupCommands(terminal: TerminalInstance): void {
    this.startupCommandLedger.add(terminal.id);
    terminal.startupExpression = undefined;
    if (terminal.startupTimer) {
      clearTimeout(terminal.startupTimer);
      terminal.startupTimer = undefined;
    }
  }


  private ensureShellInitFile(name: string, contents: string): string {
    if (!this.shellInitDir || !fs.existsSync(this.shellInitDir)) {
      this.shellInitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-shell-init-'));
      if (process.platform !== 'win32') fs.chmodSync(this.shellInitDir, 0o700);
    }

    const filePath = path.join(this.shellInitDir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    return filePath;
  }
}
