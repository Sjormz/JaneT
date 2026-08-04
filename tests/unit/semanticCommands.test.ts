import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticCommandTimeline } from '../../src/renderer/semanticCommands';

class Marker {
  isDisposed = false;
  dispose = vi.fn(() => { this.isDisposed = true; });
  constructor(public line: number) {}
}

class FakeTerminal {
  lines: Array<string | undefined> = [''];
  translate = new Map<number, (trimRight?: boolean, startColumn?: number, endColumn?: number) => string>();
  wrapped = new Set<number>();
  cursorX = 0;
  cursorY = 0;
  baseY = 0;
  viewportY = 0;
  type: 'normal' | 'alternate' = 'normal';
  markers: Marker[] = [];
  scrollToLine = vi.fn();
  scrollToBottom = vi.fn();
  registerDecoration = vi.fn(() => ({ dispose: vi.fn(), onRender: vi.fn() }));
  buffer = {
    get active() {
      return fakeActive!;
    },
  };
  registerMarker = vi.fn(() => {
    const marker = new Marker(this.baseY + this.cursorY);
    this.markers.push(marker);
    return marker;
  });
}

let fakeActive: {
  type: 'normal' | 'alternate';
  cursorX: number;
  cursorY: number;
  baseY: number;
  viewportY: number;
  getLine: (line: number) => { isWrapped: boolean; translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string } | undefined;
} | null = null;

function terminalAt(lines: string[], line: number, column: number) {
  const term = new FakeTerminal();
  term.lines = lines;
  term.cursorY = line;
  term.cursorX = column;
  fakeActive = {
    get type() { return term.type; },
    get cursorX() { return term.cursorX; },
    get cursorY() { return term.cursorY; },
    get baseY() { return term.baseY; },
    get viewportY() { return term.viewportY; },
    getLine: (index) => {
      const value = term.lines[index];
      return value === undefined
        ? undefined
        : {
            isWrapped: term.wrapped.has(index),
            translateToString: term.translate.get(index) ?? ((trimRight, start = 0, end) => {
              const sliced = value.slice(start, end);
              return trimRight ? sliced.trimEnd() : sliced;
            }),
          };
    },
  };
  return term;
}

describe('SemanticCommandTimeline', () => {
  it('records a complete OSC 133 command and output lifecycle', () => {
    const term = terminalAt(['$ echo hi'], 0, 2);
    const timeline = new SemanticCommandTimeline(term as never);

    expect(timeline.handleOsc('A')).toBe(true);
    expect(timeline.handleOsc('B')).toBe(true);
    term.cursorX = 9;
    expect(timeline.handleOsc('C')).toBe(true);
    term.lines.push('hi');
    term.cursorY = 1;
    term.cursorX = 2;
    expect(timeline.handleOsc('D;0')).toBe(true);

    expect(timeline.commands).toMatchObject([{ command: 'echo hi', output: 'hi', exitCode: 0 }]);
  });

  it('joins wrapped buffer rows without inventing newlines', () => {
    const term = terminalAt(['$ echo wrap', 'ped', 'first', 'second'], 0, 2);
    term.wrapped.add(1);
    const timeline = new SemanticCommandTimeline(term as never);

    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorY = 1; term.cursorX = 3; timeline.handleOsc('C');
    term.cursorY = 3; term.cursorX = 6; timeline.handleOsc('D;0');

    expect(timeline.commands[0]).toMatchObject({ command: 'echo wrapped', output: 'first\nsecond' });
  });

  it('reconstructs cell-column text and trims terminal padding', () => {
    const term = terminalAt(['$ 你écho   ', 'ok      '], 0, 2);
    const firstRow = vi.fn((trimRight?: boolean, startColumn = 0, endColumn = 80) => {
      expect(trimRight).toBe(true);
      return startColumn === 2 && endColumn === 8 ? '你écho' : '';
    });
    const secondRow = vi.fn((trimRight?: boolean, startColumn = 0, endColumn = 80) => {
      expect(trimRight).toBe(true);
      return startColumn === 0 && endColumn === 8 ? 'ok' : '';
    });
    term.translate.set(0, firstRow);
    term.translate.set(1, secondRow);
    const timeline = new SemanticCommandTimeline(term as never);

    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 8; timeline.handleOsc('C');
    term.cursorY = 1; timeline.handleOsc('D;0');

    expect(timeline.commands[0]).toMatchObject({ command: '你écho', output: 'ok' });
    expect(firstRow).toHaveBeenCalledWith(true, 2, 8);
    expect(secondRow).toHaveBeenCalledWith(true, 0, 8);
  });

  it('starts execution timing after command reconstruction at C', () => {
    const term = terminalAt(['$ pwd', '/tmp'], 0, 2);
    const completed = vi.fn();
    let now = 0;
    const timeline = new SemanticCommandTimeline(term as never, completed, () => now);

    timeline.handleOsc('A');
    now = 1_000; timeline.handleOsc('B');
    now = 61_000; term.cursorX = 5; timeline.handleOsc('C');
    now = 62_000; term.cursorY = 1; term.cursorX = 4; timeline.handleOsc('D;7');
    timeline.handleOsc('D;7');

    expect(completed).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith({
      command: 'pwd', output: '/tmp', exitCode: 7,
      startedAt: 61_000, completedAt: 62_000, durationMs: 1_000,
    });
    expect(JSON.parse(JSON.stringify(completed.mock.calls[0][0]))).toEqual(completed.mock.calls[0][0]);
    expect(completed.mock.calls[0][0]).not.toHaveProperty('marker');
    expect(completed.mock.calls[0][0]).not.toHaveProperty('decoration');
  });

  it('reports a submitted command at C before it completes', () => {
    const term = terminalAt(['$ tmux attach'], 0, 2);
    const completed = vi.fn();
    const started = vi.fn();
    const timeline = new SemanticCommandTimeline(term as never, completed, () => 123, started);

    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 13; timeline.handleOsc('C');

    expect(started).toHaveBeenCalledOnce();
    expect(started).toHaveBeenCalledWith({ command: 'tmux attach', startedAt: 123 });
    expect(completed).not.toHaveBeenCalled();
  });

  it('cancels a running command when a new prompt arrives without D', () => {
    const term = terminalAt(['$ exit'], 0, 2);
    const cancelled = vi.fn();
    const timeline = new SemanticCommandTimeline(term as never, undefined, () => 123, undefined, cancelled);

    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 6; timeline.handleOsc('C');
    timeline.handleOsc('A');

    expect(cancelled).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledWith({ command: 'exit', startedAt: 123 });
  });

  it('rejects malformed and out-of-order transitions without retaining partial markers', () => {
    const term = terminalAt(['untrusted'], 0, 9);
    const timeline = new SemanticCommandTimeline(term as never);

    for (const data of ['C', 'D;0', 'A;extra', `A${'x'.repeat(65)}`, 'Z']) {
      expect(timeline.handleOsc(data)).toBe(true);
    }
    expect(timeline.commands).toEqual([]);
    expect(term.registerMarker).not.toHaveBeenCalled();

    timeline.handleOsc('A');
    timeline.handleOsc('B');
    expect(term.markers[0].isDisposed).toBe(false);
    timeline.handleOsc('A');
    expect(term.markers[0].isDisposed).toBe(true);
  });

  it('disposes pending state when C reconstructs an empty command', () => {
    const term = terminalAt(['$   '], 0, 2);
    const completed = vi.fn();
    const timeline = new SemanticCommandTimeline(term as never, completed);
    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 5; timeline.handleOsc('C');

    expect(term.markers[0].isDisposed).toBe(true);
    timeline.handleOsc('D;0');
    expect(completed).not.toHaveBeenCalled();
    expect(timeline.commands).toEqual([]);
  });

  it('disposes pending state when any command row is unavailable at C', () => {
    const term = terminalAt(['$ head', 'tail', 'output'], 0, 2);
    term.wrapped.add(1);
    const completed = vi.fn();
    const timeline = new SemanticCommandTimeline(term as never, completed);
    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.lines[0] = undefined;
    term.cursorY = 1; term.cursorX = 4; timeline.handleOsc('C');

    expect(term.markers[0].isDisposed).toBe(true);
    term.cursorY = 2; term.cursorX = 6; timeline.handleOsc('D;0');
    expect(completed).not.toHaveBeenCalled();
    expect(timeline.commands).toEqual([]);
  });

  it('disposes pending state when C reconstructs an oversized command', () => {
    const oversized = 'x'.repeat(64 * 1024 + 1);
    const term = terminalAt([oversized], 0, 0);
    const completed = vi.fn();
    const timeline = new SemanticCommandTimeline(term as never, completed);
    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = oversized.length; timeline.handleOsc('C');

    expect(term.markers[0].isDisposed).toBe(true);
    timeline.handleOsc('D;0');
    expect(completed).not.toHaveBeenCalled();
    expect(timeline.commands).toEqual([]);
  });

  it('bounds retained commands and skips commands whose text is unavailable', () => {
    const term = terminalAt(['$ x'], 0, 2);
    const timeline = new SemanticCommandTimeline(term as never);

    for (let index = 0; index < 201; index += 1) {
      term.lines[0] = `$ command-${index}`;
      term.cursorX = 2;
      timeline.handleOsc('A'); timeline.handleOsc('B');
      term.cursorX = 13;
      timeline.handleOsc('C'); timeline.handleOsc('D;0');
    }
    expect(timeline.commands).toHaveLength(200);
    expect(term.markers[0].isDisposed).toBe(true);

    term.lines[0] = undefined;
    timeline.handleOsc('A'); timeline.handleOsc('B'); timeline.handleOsc('C'); timeline.handleOsc('D;0');
    expect(timeline.commands).toHaveLength(200);
  });

  it('navigates live command markers without writing shell input', () => {
    const term = terminalAt(['$ one', '$ two'], 0, 2);
    const timeline = new SemanticCommandTimeline(term as never);
    for (let line = 0; line < 2; line += 1) {
      term.cursorY = line; term.cursorX = 2;
      timeline.handleOsc('A'); timeline.handleOsc('B');
      term.cursorX = 5; timeline.handleOsc('C'); timeline.handleOsc('D;0');
    }
    term.viewportY = 2;

    expect(timeline.previous()).toBe(true);
    expect(term.scrollToLine).toHaveBeenLastCalledWith(1);
    expect(timeline.previous()).toBe(true);
    expect(term.scrollToLine).toHaveBeenLastCalledWith(0);
    expect(timeline.next()).toBe(true);
    expect(term.scrollToLine).toHaveBeenLastCalledWith(1);
    expect(timeline.next()).toBe(true);
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
  });

  it('preserves the selected command when an earlier marker is disposed', () => {
    const term = terminalAt(['$ one', '$ two', '$ tri'], 0, 2);
    const timeline = new SemanticCommandTimeline(term as never);
    for (let line = 0; line < 3; line += 1) {
      term.cursorY = line; term.cursorX = 2;
      timeline.handleOsc('A'); timeline.handleOsc('B');
      term.cursorX = 5; timeline.handleOsc('C'); timeline.handleOsc('D;0');
    }
    term.viewportY = 3;
    timeline.previous();
    timeline.previous();
    expect(timeline.current()?.command).toBe('two');

    term.markers[0].dispose();

    expect(timeline.current()?.command).toBe('two');
    expect(timeline.next()).toBe(true);
    expect(timeline.current()?.command).toBe('tri');
    expect(term.scrollToLine).toHaveBeenLastCalledWith(2);
  });

  it('marks nonzero exits and releases markers and decorations on dispose', () => {
    const term = terminalAt(['$ false'], 0, 2);
    const timeline = new SemanticCommandTimeline(term as never);
    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 7; timeline.handleOsc('C'); timeline.handleOsc('D;7');

    expect(term.registerDecoration).toHaveBeenCalledWith({ marker: term.markers[0], x: 0, width: 1 });
    const decoration = timeline.commands[0].decoration!;
    timeline.dispose();
    expect(decoration.dispose).toHaveBeenCalledOnce();
    expect(term.markers[0].dispose).toHaveBeenCalledOnce();
  });

  it('ignores alternate-screen lifecycles', () => {
    const term = terminalAt(['$ secret'], 0, 2);
    term.type = 'alternate';
    const timeline = new SemanticCommandTimeline(term as never);
    for (const data of ['A', 'B', 'C', 'D;1']) timeline.handleOsc(data);
    expect(timeline.commands).toEqual([]);
  });
});

afterEach(() => { fakeActive = null; });
;