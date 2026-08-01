import { describe, expect, it } from 'vitest';
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
  it('normalizes legacy values per entry, preserving first valid duplicate and only the first 256 candidates', () => {
    const input: unknown[] = [entry(), { ...entry('bad'), output: 'secret' }, entry('one'), entry('two')];
    input.push(...Array.from({ length: MAX_COMMAND_HISTORY_ENTRIES }, (_, index) => entry(`later-${index}`)));
    expect(normalizeCommandHistory(input)).toEqual([entry(), entry('two'), ...input.slice(4, 256)]);
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
