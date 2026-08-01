import { describe, expect, it, vi } from 'vitest';
import {
  cloneCommandHistory,
  isValidCommandHistory,
  MAX_COMMAND_HISTORY_ENTRIES,
  normalizeCommandHistory,
  type CommandHistoryEntry,
} from '../../src/shared/commandHistory';

const entry = (id = 'one'): CommandHistoryEntry => ({
  id, command: 'printf ok', startedAt: 10, durationMs: 5, exitCode: 0,
  context: { kind: 'local', cwd: '/repo' },
});

describe('command history boundary', () => {
  it('normalizes up to 256 valid unique legacy entries across all candidates', () => {
    const input: unknown[] = [entry(), { ...entry('bad'), output: 'secret' }, entry('one'), entry('two')];
    input.push(...Array.from({ length: MAX_COMMAND_HISTORY_ENTRIES }, (_, index) => entry(`later-${index}`)));
    expect(normalizeCommandHistory(input)).toEqual([entry(), entry('two'), ...input.slice(4, 258)]);
  });

  it('never invokes entry or nested context accessors', () => {
    const entryGetter = vi.fn(() => 'secret');
    const contextGetter = vi.fn(() => '/secret');
    const withEntryAccessor = { ...entry() } as Record<string, unknown>;
    Object.defineProperty(withEntryAccessor, 'command', { enumerable: true, get: entryGetter });
    const withContextAccessor = { ...entry(), context: { kind: 'local' } };
    Object.defineProperty(withContextAccessor.context, 'cwd', { enumerable: true, get: contextGetter });

    expect(isValidCommandHistory([withEntryAccessor])).toBe(false);
    expect(normalizeCommandHistory([withContextAccessor])).toEqual([]);
    expect(entryGetter).not.toHaveBeenCalled();
    expect(contextGetter).not.toHaveBeenCalled();
  });

  it('fails closed on throwing proxies and custom prototypes', () => {
    const throwing = new Proxy(entry(), { ownKeys: () => { throw new Error('trap'); } });
    const custom = Object.assign(Object.create({ polluted: true }), entry());
    const nestedCustom = { ...entry(), context: Object.assign(Object.create({ polluted: true }), entry().context) };

    expect(() => isValidCommandHistory([throwing])).not.toThrow();
    expect(isValidCommandHistory([throwing])).toBe(false);
    expect(normalizeCommandHistory([custom, nestedCustom])).toEqual([]);
  });

  it('rejects transparent proxies around entries and nested contexts', () => {
    const proxiedEntry = new Proxy(entry(), {});
    const proxiedContext = { ...entry(), context: new Proxy(entry().context, {}) };

    expect(isValidCommandHistory([proxiedEntry])).toBe(false);
    expect(normalizeCommandHistory([proxiedContext])).toEqual([]);
  });

  it('rejects non-enumerable required and optional entry fields', () => {
    for (const key of ['id', 'exitCode'] as const) {
      const candidate = entry();
      Object.defineProperty(candidate, key, { value: candidate[key], enumerable: false });
      expect(isValidCommandHistory([candidate])).toBe(false);
    }
  });

  it('rejects non-enumerable required and optional nested context fields', () => {
    const local = entry();
    Object.defineProperty(local.context, 'cwd', { value: '/repo', enumerable: false });
    const ssh = { ...entry(), context: { kind: 'ssh' as const, label: 'host' } };
    Object.defineProperty(ssh.context, 'label', { value: 'host', enumerable: false });

    expect(normalizeCommandHistory([local, ssh])).toEqual([]);
  });

  it('accepts and clones null-prototype entries and nested contexts with exact keys', () => {
    const context = Object.assign(Object.create(null), { kind: 'local', cwd: '/repo' });
    const candidate = Object.assign(Object.create(null), entry(), { context });

    expect(isValidCommandHistory([candidate])).toBe(true);
    const normalized = normalizeCommandHistory([candidate]);
    expect(normalized).toEqual([entry()]);
    expect(Object.getPrototypeOf(normalized[0])).toBe(Object.prototype);
    expect(Object.getPrototypeOf(normalized[0].context)).toBe(Object.prototype);
  });

  it('strictly rejects malformed live collections and extra nested keys', () => {
    expect(isValidCommandHistory([entry(), entry('two')])).toBe(true);
    expect(isValidCommandHistory([entry(), entry()])).toBe(false);
    expect(isValidCommandHistory([{ ...entry(), output: 'secret' }])).toBe(false);
    expect(isValidCommandHistory([{ ...entry(), context: { kind: 'local', cwd: '/repo', host: 'bad' } }])).toBe(false);
    expect(isValidCommandHistory(Array.from({ length: 257 }, (_, index) => entry(String(index))))).toBe(false);
  });

  it('deep clones normalized and cloned entries', () => {
    const source = [entry()];
    const normalized = normalizeCommandHistory(source);
    const cloned = cloneCommandHistory(source);
    source[0].context = { kind: 'ssh', label: 'changed' };
    expect(normalized[0].context).toEqual({ kind: 'local', cwd: '/repo' });
    (cloned[0].context as { kind: 'local'; cwd: string }).cwd = '/mutated';
    expect(normalized[0].context).toEqual({ kind: 'local', cwd: '/repo' });
  });
});
