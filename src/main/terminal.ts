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

function shellLaunch(shell: string, init: string): { args: string[]; env: NodeJS.ProcessEnv } {
  if (!init) return { args: [], env: {} };

  const base = path.basename(shell).toLowerCase();
  if (base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe') {
    return { args: ['-NoLogo', '-NoExit', '-Command', init], env: {} };
  }

  if (base === 'bash' || base === 'bash.exe') {
    const rcfile = path.join(os.tmpdir(), 'janet-bashrc');
    fs.writeFileSync(rcfile, `[ -f ~/.bashrc ] && . ~/.bashrc\n${init}\n`, 'utf8');
    return { args: ['--rcfile', rcfile, '-i'], env: {} };
  }

  if (base === 'zsh' || base === 'zsh.exe') {
    const zdotdir = path.join(os.tmpdir(), 'janet-zdotdir');
    fs.mkdirSync(zdotdir, { recursive: true });
    fs.writeFileSync(path.join(zdotdir, '.zshrc'), `[ -f ~/.zshrc ] && . ~/.zshrc\n${init}\n`, 'utf8');
    return { args: ['-i'], env: { ZDOTDIR: zdotdir } };
  }

  if (base === 'fish' || base === 'fish.exe') {
    return { args: ['--init-command', init], env: {} };
  }

  return { args: [], env: {} };
}

export class TerminalManager {
  private terminals: Map<string, TerminalInstance> = new Map();

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
    const defaultCwd = cwd || os.homedir();

    const init = buildShellInit(defaultShell);

    const launch = shellLaunch(defaultShell, init);

    const pty = spawn(defaultShell, launch.args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: defaultCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ...launch.env,
        // Ensure shells that key on these (some readline configs) stay
        // in their interactive mode.
        SHELL: defaultShell,
      },
    });

    this.terminals.set(id, { pty, id, wired: !!onData, cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
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
    term.pty.resize(nextCols, nextRows);
    term.cols = nextCols;
    term.rows = nextRows;
  }

  write(id: string, data: string): void {
    const term = this.terminals.get(id);
    if (term) {
      term.pty.write(data);
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
  }
}
