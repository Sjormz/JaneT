import { describe, it, expect, vi } from 'vitest';
import { runCleanup } from '../../src/renderer/components/TerminalPane';

describe('runCleanup', () => {
  it('invokes function entries with no arguments', () => {
    const fn = vi.fn();
    runCleanup([fn]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith();
  });

  it('invokes .dispose() on IDisposable entries', () => {
    const dispose = vi.fn();
    runCleanup([{ dispose }]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('handles a mixed array of functions and disposables', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const dispose1 = vi.fn();
    const dispose2 = vi.fn();
    runCleanup([fn1, { dispose: dispose1 }, fn2, { dispose: dispose2 }]);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from a failing entry and still runs the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good1 = vi.fn();
    const good2 = vi.fn();
    runCleanup([
      good1,
      () => { throw new Error('boom'); },
      good2,
      { dispose: () => { throw new Error('dispose boom'); } },
    ]);
    // All entries attempted; the good ones ran, the bad ones were
    // caught and logged.
    expect(good1).toHaveBeenCalledTimes(1);
    expect(good2).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores entries that are neither functions nor disposables', () => {
    // This is the regression we just fixed: a raw IDisposable (an
    // object with .dispose()) used to be passed straight to fn() and
    // threw "fn is not a function". Now we call .dispose() on it.
    const entry = { dispose: vi.fn() };
    expect(() => runCleanup([entry])).not.toThrow();
    expect(entry.dispose).toHaveBeenCalledTimes(1);
  });

  it('handles null, undefined, and primitives without throwing', () => {
    expect(() => runCleanup([null, undefined, 42, 'string', true])).not.toThrow();
  });

  it('handles an empty array', () => {
    expect(() => runCleanup([])).not.toThrow();
  });

  it('ignores objects that have a non-function .dispose property', () => {
    // e.g. { dispose: 'string' } — defensive against shape mismatches.
    const entry = { dispose: 'not a function' };
    expect(() => runCleanup([entry])).not.toThrow();
  });
});
