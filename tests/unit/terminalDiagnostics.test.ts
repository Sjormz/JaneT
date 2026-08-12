import { describe, expect, it, vi } from 'vitest';
import {
  DISABLE_TERMINAL_MOUSE_TRACKING,
  inspectTerminalControlSequences,
  logTerminalDiagnostic,
  restoreTerminalMouseTracking,
  suppressTerminalMouseTracking,
} from '../../src/renderer/terminalDiagnostics';

describe('terminal diagnostics and protected selection controls', () => {
  it('disables supported tracking modes and restores the exact previous mode', () => {
    expect(DISABLE_TERMINAL_MOUSE_TRACKING).toBe('\u001b[?1000l\u001b[?1002l\u001b[?1003l');
    expect(restoreTerminalMouseTracking('none')).toBe('');
    expect(restoreTerminalMouseTracking('x10')).toBe('\u001b[?9h');
    expect(restoreTerminalMouseTracking('vt200')).toBe('\u001b[?1000h');
    expect(restoreTerminalMouseTracking('drag')).toBe('\u001b[?1002h');
    expect(restoreTerminalMouseTracking('any')).toBe('\u001b[?1003h');
  });

  it('suppresses TUI mouse enables while preserving unrelated DEC modes', () => {
    expect(suppressTerminalMouseTracking(
      `before\u001b[?1003hmiddle\u001b[?25;1002;1006hafter`,
    )).toBe(`beforemiddle\u001b[?25;1006hafter`);
  });

  it('reports only relevant control-sequence names and never includes terminal text', () => {
    const controls = inspectTerminalControlSequences(
      `private output\u001b[?1049h\u001b[?1003h\u001b[?1006h\u001b[2J`,
    );
    expect(controls).toEqual([
      'alternate-screen-enter',
      'mouse-any-enable',
      'sgr-mouse-enable',
      'clear-screen',
    ]);
    expect(JSON.stringify(controls)).not.toContain('private output');
  });

  it('does not log unless explicitly enabled', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    logTerminalDiagnostic(false, 'term-1', 'selection-change', { selectionLength: 12 });
    expect(info).not.toHaveBeenCalled();
    logTerminalDiagnostic(true, 'term-1', 'selection-change', { selectionLength: 12 });
    expect(info).toHaveBeenCalledWith('[JaneT terminal diagnostics]', {
      termId: 'term-1',
      event: 'selection-change',
      selectionLength: 12,
    });
    info.mockRestore();
  });
});
