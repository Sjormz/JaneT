import { describe, it, expect, vi } from 'vitest';
import { runCleanup } from '../../src/renderer/components/TerminalPane';

describe('runCleanup', () => {
  it('runs functions and disposables once in order without arguments', () => {
    const order: string[] = [];
    const fn = vi.fn(() => order.push('function'));
    const entry = { dispose: vi.fn(function (this: unknown) {
      expect(this).toBe(entry);
      order.push('dispose');
    }) };
    runCleanup([fn, entry]);
    expect(order).toEqual(['function', 'dispose']);
    expect(fn).toHaveBeenCalledExactlyOnceWith();
    expect(entry.dispose).toHaveBeenCalledExactlyOnceWith();
  });

  it('continues after throwing functions and disposables and reports both failures', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const remaining = vi.fn();
    try {
      runCleanup([
        () => { throw new Error('function failed'); },
        { dispose: () => { throw new Error('dispose failed'); } },
        remaining,
      ]);
      expect(remaining).toHaveBeenCalledExactlyOnceWith();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally { warn.mockRestore(); }
  });

  it('ignores empty and malformed entries without preventing valid cleanup', () => {
    const valid = vi.fn();
    expect(() => runCleanup([])).not.toThrow();
    runCleanup([null, undefined, 42, 'string', true, {}, { dispose: 'not a function' }, valid]);
    expect(valid).toHaveBeenCalledExactlyOnceWith();
  });
});
