import { describe, expect, it, vi } from 'vitest';
import {
  inspectTerminalControlSequences,
  logTerminalDiagnostic,
} from '../../src/renderer/terminalDiagnostics';

describe('terminal diagnostics', () => {
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
