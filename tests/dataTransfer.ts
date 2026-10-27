import { vi } from 'vitest';

// JSDOM has no DataTransfer. Share the string-data surface used by path drags.
export function createDataTransfer(initial: Record<string, string> = {}): DataTransfer {
  const data = new Map(Object.entries(initial));
  return {
    dropEffect: 'none', effectAllowed: 'uninitialized',
    get types() { return [...data.keys()]; },
    setData: vi.fn((type: string, value: string) => { data.set(type, value); }),
    getData: vi.fn((type: string) => data.get(type) ?? ''),
  } as unknown as DataTransfer;
}
