import { describe, expect, it } from 'vitest';
import { NativeTerminalCapacity } from '../../src/main/terminalCapacity';

describe('native terminal capacity', () => {
  it('bounds terminals and releases destroyed owners', () => {
    const capacity = new NativeTerminalCapacity(1);
    capacity.reserve('first');
    expect(() => capacity.reserve('second')).toThrow(/native terminal limit of 1/i);
    capacity.release('first');
    expect(() => capacity.reserve('second')).not.toThrow();
  });

  it('rejects duplicate terminal ids without consuming capacity', () => {
    const capacity = new NativeTerminalCapacity(2);
    capacity.reserve('first');
    expect(() => capacity.reserve('first')).toThrow(/already in use/i);
    expect(() => capacity.reserve('second')).not.toThrow();
  });

  it('does not free another owner when release is repeated', () => {
    const capacity = new NativeTerminalCapacity(1);
    capacity.reserve('first');
    capacity.release('unknown');
    expect(() => capacity.reserve('second')).toThrow(/limit/i);
    capacity.release('first');
    capacity.release('first');
    expect(() => capacity.reserve('second')).not.toThrow();
  });
});
