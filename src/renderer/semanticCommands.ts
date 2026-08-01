import type { IDecoration, IMarker, Terminal } from '@xterm/xterm';

const MAX_COMMANDS = 200;
const MAX_TEXT = 64 * 1024;

type Position = { line: number; column: number };
type Phase = 'idle' | 'prompt' | 'command' | 'output';

export interface SemanticCommandEvent {
  command: string;
  output: string;
  exitCode?: number;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

interface SemanticCommand extends SemanticCommandEvent {
  marker: IMarker;
  decoration?: IDecoration;
}

export class SemanticCommandTimeline {
  readonly commands: SemanticCommand[] = [];
  private phase: Phase = 'idle';
  private commandStart: Position | null = null;
  private commandMarker: IMarker | null = null;
  private outputStart: Position | null = null;
  private command = '';
  private startedAt = 0;
  private navigationIndex: number | null = null;

  constructor(
    private readonly terminal: Terminal,
    private readonly onComplete?: (event: SemanticCommandEvent) => void,
    private readonly now: () => number = Date.now,
  ) {}

  handleOsc(data: string): boolean {
    if (data.length > 64 || this.terminal.buffer.active.type !== 'normal') {
      this.resetPending();
      return true;
    }
    const [code, arg, ...rest] = data.split(';');
    if (rest.length || !['A', 'B', 'C', 'D'].includes(code)) return true;

    if (code === 'A') {
      this.resetPending();
      this.phase = 'prompt';
    } else if (code === 'B' && this.phase === 'prompt' && arg === undefined) {
      this.phase = 'command';
      this.commandStart = this.position();
      this.commandMarker = this.terminal.registerMarker(0);
      this.startedAt = this.now();
    } else if (code === 'C' && this.phase === 'command' && arg === undefined && this.commandStart && this.commandMarker) {
      const end = this.position();
      const command = this.read(this.commandStart, end).trim();
      if (!command) return true;
      this.command = command;
      this.outputStart = end;
      this.phase = 'output';
    } else if (code === 'D' && this.phase === 'output' && this.outputStart && this.commandMarker) {
      if (arg !== undefined && !/^\d+$/.test(arg)) return true;
      const exitCode = arg === undefined ? undefined : Number(arg);
      if (exitCode !== undefined && !Number.isSafeInteger(exitCode)) return true;
      const output = this.read(this.outputStart, this.position()).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      const completedAt = this.now();
      const event: SemanticCommandEvent = {
        command: this.command,
        output,
        exitCode,
        startedAt: this.startedAt,
        completedAt,
        durationMs: Math.max(0, completedAt - this.startedAt),
      };
      const entry: SemanticCommand = { ...event, marker: this.commandMarker };
      if (exitCode !== undefined && exitCode !== 0) {
        entry.decoration = this.terminal.registerDecoration({ marker: this.commandMarker, x: 0, width: 1 }) ?? undefined;
        entry.decoration?.onRender((element) => {
          element.classList.add('terminal-command-failed');
          element.title = `Command failed with exit code ${exitCode}`;
        });
      }
      this.commands.push(entry);
      while (this.commands.length > MAX_COMMANDS) this.disposeCommand(this.commands.shift()!);
      this.onComplete?.(event);
      this.resetPending(false);
      this.navigationIndex = null;
    }
    return true;
  }

  previous(): boolean {
    const available = this.liveCommands();
    if (!available.length) return false;
    if (this.navigationIndex === null) {
      const viewport = this.terminal.buffer.active.viewportY;
      let index = available.length - 1;
      while (index >= 0 && available[index].marker.line >= viewport) index -= 1;
      this.navigationIndex = index < 0 ? available.length - 1 : index;
    } else if (this.navigationIndex > 0) {
      this.navigationIndex -= 1;
    }
    this.terminal.scrollToLine(available[this.navigationIndex].marker.line);
    return true;
  }

  next(): boolean {
    const available = this.liveCommands();
    if (!available.length || this.navigationIndex === null) return false;
    if (this.navigationIndex < available.length - 1) {
      this.navigationIndex += 1;
      this.terminal.scrollToLine(available[this.navigationIndex].marker.line);
    } else {
      this.navigationIndex = null;
      this.terminal.scrollToBottom();
    }
    return true;
  }

  current(): SemanticCommand | null {
    if (this.navigationIndex === null) return null;
    return this.liveCommands()[this.navigationIndex] ?? null;
  }

  dispose(): void {
    this.resetPending();
    for (const command of this.commands.splice(0)) this.disposeCommand(command);
  }

  private position(): Position {
    const buffer = this.terminal.buffer.active;
    return { line: buffer.baseY + buffer.cursorY, column: buffer.cursorX };
  }

  private read(start: Position, end: Position): string {
    if (end.line < start.line || end.line - start.line > 10_000) return '';
    const lines: string[] = [];
    let length = 0;
    for (let line = start.line; line <= end.line; line += 1) {
      const bufferLine = this.terminal.buffer.active.getLine(line);
      const value = bufferLine?.translateToString(false) ?? '';
      const text = value.slice(line === start.line ? start.column : 0, line === end.line ? end.column : undefined);
      const separator = line > start.line && !bufferLine?.isWrapped ? '\n' : '';
      length += separator.length + text.length;
      if (length > MAX_TEXT) return '';
      lines.push(separator, text);
    }
    return lines.join('');
  }

  private liveCommands(): SemanticCommand[] {
    return this.commands.filter((entry) => !entry.marker.isDisposed);
  }

  private resetPending(disposeMarker = true): void {
    if (disposeMarker) this.commandMarker?.dispose();
    this.phase = 'idle';
    this.commandStart = null;
    this.commandMarker = null;
    this.outputStart = null;
    this.command = '';
    this.startedAt = 0;
  }

  private disposeCommand(command: SemanticCommand): void {
    command.decoration?.dispose();
    command.marker.dispose();
  }
}
