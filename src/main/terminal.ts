import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, IPty } from 'node-pty';
import { buildShellInit } from './shell-init';

interface TerminalInstance {
  pty: IPty;
  id: string;
  /** True once we've wired the single onData forwarder for this pty. */
  wired: boolean;
  cols: number;
  rows: number;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

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
  private shellInitDir: string | null = null;

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
  create(id: string, cwd?: string, shell?: string, onData?: (data: string) => void): IPty {
    const existing = this.terminals.get(id);
    if (existing) {
      if (onData && !existing.wired) {
        existing.wired = true;
        existing.pty.onData(onData);
      }
      return existing.pty;
    }

    const defaultShell = shell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
    const defaultCwd = resolveTerminalCwd(cwd);

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

    this.terminals.set(id, { pty, id, wired: !!onData, cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
    pty.onExit(() => {
      const current = this.terminals.get(id);
      if (current?.pty === pty) {
        this.terminals.delete(id);
      }
    });
    if (onData) pty.onData(onData);
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

  write(id: string, data: string): void {
    const term = this.terminals.get(id);
    if (term) {
      term.pty.write(data);
    }
  }

  writeBinary(id: string, data: string): void {
    const term = this.terminals.get(id);
    if (term) {
      term.pty.write(Buffer.from(data, 'binary'));
    }
  }

  destroy(id: string): void {
    const term = this.terminals.get(id);
    if (term) {
      try { term.pty.kill(); } catch {}
      this.terminals.delete(id);
    }
  }

  cleanup(): void {
    for (const [id] of this.terminals) {
      this.destroy(id);
    }
    if (this.shellInitDir) {
      try { fs.rmSync(this.shellInitDir, { recursive: true, force: true }); } catch {}
      this.shellInitDir = null;
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
