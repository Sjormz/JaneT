import * as os from 'os';
import * as path from 'path';
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

    // We pass the init as the first arg to the shell. For PowerShell
    // that's `-NoLogo -NoExit -Command <init>`. For bash/zsh/fish it's
    // `-c '<init>; exec <shell> -i'` so the init runs once and then we
    // get a normal interactive session. For unknown shells, fall back
    // to the bare spawn.
    const base = path.basename(defaultShell).toLowerCase();
    let args: string[] = [];
    if (!init) {
      args = [];
    } else if (base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe') {
      args = ['-NoLogo', '-NoExit', '-Command', init];
    } else if (base === 'bash' || base === 'bash.exe' || base === 'zsh' || base === 'zsh.exe' || base === 'fish' || base === 'fish.exe') {
      // `<init>; exec <shell> -i` — eval the init, then start a fresh
      // interactive shell that inherits the modifications.
      args = ['-c', `${init}\nexec "${defaultShell}" -i`];
    }

    const pty = spawn(defaultShell, args, {
      name: 'xterm-256color',
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      cwd: defaultCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
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
