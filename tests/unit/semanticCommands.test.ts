import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticCommandTimeline } from '../../src/renderer/semanticCommands';

class Marker {
  isDisposed = false;
  dispose = vi.fn(() => { this.isDisposed = true; });
  constructor(public line: number) {}
}

class FakeTerminal {
  lines: Array<string | undefined> = [''];
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
  getLine: (line: number) => { isWrapped: boolean; translateToString: () => string } | undefined;
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
        : { isWrapped: term.wrapped.has(index), translateToString: () => value };
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

  it('emits one JSON-safe completion event with deterministic nonnegative timing', () => {
    const term = terminalAt(['$ pwd', '/tmp'], 0, 2);
    const completed = vi.fn();
    const times = [1_000, 900];
    const timeline = new SemanticCommandTimeline(term as never, completed, () => times.shift()!);

    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 5; timeline.handleOsc('C');
    term.cursorY = 1; term.cursorX = 4; timeline.handleOsc('D;7');
    timeline.handleOsc('D;7');

    expect(completed).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith({
      command: 'pwd', output: '/tmp', exitCode: 7,
      startedAt: 1_000, completedAt: 900, durationMs: 0,
    });
    expect(JSON.parse(JSON.stringify(completed.mock.calls[0][0]))).toEqual(completed.mock.calls[0][0]);
    expect(completed.mock.calls[0][0]).not.toHaveProperty('marker');
    expect(completed.mock.calls[0][0]).not.toHaveProperty('decoration');
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

  it('marks nonzero exits and releases markers and decorations on dispose', () => {
    const term = terminalAt(['$ false'], 0, 2);
    const timeline = new SemanticCommandTimeline(term as never);
    timeline.handleOsc('A'); timeline.handleOsc('B');
    term.cursorX = 7; timeline.handleOsc('C'); timeline.handleOsc('D;7');

    expect(term.registerDecoration).toHaveBeenCalledWith(expect.objectContaining({ marker: term.markers[0] }));
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