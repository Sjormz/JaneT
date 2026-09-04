export type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

export const DISABLE_TERMINAL_MOUSE_TRACKING = '\u001b[?9l\u001b[?1000l\u001b[?1002l\u001b[?1003l';

// PTY packets can split a control sequence anywhere, including after ESC.
export function createMouseTrackingFilter() {
  let pending = '';
  const modes: Record<string, TerminalMouseTrackingMode> = { 9: 'x10', 1000: 'vt200', 1002: 'drag', 1003: 'any' };
  return (data: string, protect: boolean, onMode: (mode: TerminalMouseTrackingMode) => void): string => {
    const input = pending + data;
    pending = '';
    const tail = input.match(/\u001b(?:\[(?:\?[0-9;]*)?)?$/);
    // Bound malformed/incomplete sequences instead of retaining arbitrary output.
    if (tail && tail[0].length <= 64) pending = tail[0];
    const complete = pending ? input.slice(0, -pending.length) : input;
    return complete.replace(/\u001b\[\?([0-9;]+)([hl])/g, (sequence, parameters: string, operation: string) => {
      if (!protect) return sequence;
      const retained = parameters.split(';').filter((parameter) => {
        if (!modes[parameter]) return true;
        onMode(operation === 'h' ? modes[parameter] : 'none');
        return false;
      });
      return retained.length ? `\u001b[?${retained.join(';')}${operation}` : '';
    });
  };
}

export function restoreTerminalMouseTracking(mode: TerminalMouseTrackingMode): string {
  switch (mode) {
    case 'x10': return '\u001b[?9h';
    case 'vt200': return '\u001b[?1000h';
    case 'drag': return '\u001b[?1002h';
    case 'any': return '\u001b[?1003h';
    default: return '';
  }
}

export function suppressTerminalMouseTracking(data: string): string {
  return data.replace(/\u001b\[\?([0-9;]+)h/g, (sequence, parameters: string) => {
    const retained = parameters
      .split(';')
      .filter((parameter) => !['9', '1000', '1002', '1003'].includes(parameter));
    return retained.length ? `\u001b[?${retained.join(';')}h` : '';
  });
}

export function inspectTerminalControlSequences(data: string): string[] {
  const observed: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['alternate-screen-enter', /\u001b\[\?1049h/],
    ['alternate-screen-exit', /\u001b\[\?1049l/],
    ['mouse-x10-enable', /\u001b\[\?9h/],
    ['mouse-vt200-enable', /\u001b\[\?1000h/],
    ['mouse-drag-enable', /\u001b\[\?1002h/],
    ['mouse-any-enable', /\u001b\[\?1003h/],
    ['mouse-x10-disable', /\u001b\[\?9l/],
    ['mouse-vt200-disable', /\u001b\[\?1000l/],
    ['mouse-drag-disable', /\u001b\[\?1002l/],
    ['mouse-any-disable', /\u001b\[\?1003l/],
    ['sgr-mouse-enable', /\u001b\[\?1006h/],
    ['sgr-mouse-disable', /\u001b\[\?1006l/],
    ['clear-screen', /\u001b\[(?:2|3)J/],
    ['terminal-reset', /\u001bc/],
  ];
  for (const [name, pattern] of checks) {
    if (pattern.test(data)) observed.push(name);
  }
  return observed;
}

export function logTerminalDiagnostic(
  enabled: boolean,
  termId: string,
  event: string,
  details: Record<string, unknown> = {},
): void {
  if (!enabled) return;
  console.info('[JaneT terminal diagnostics]', { termId, event, ...details });
}
