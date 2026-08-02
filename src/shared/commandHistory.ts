export const MAX_COMMAND_HISTORY_ENTRIES = 256;
export const MAX_COMMAND_HISTORY_ID_LENGTH = 64;
export const MAX_COMMAND_HISTORY_COMMAND_LENGTH = 64 * 1024;
export const MAX_COMMAND_HISTORY_CWD_LENGTH = 8_192;
export const MAX_COMMAND_HISTORY_SSH_LABEL_LENGTH = 512;

export type CommandHistoryContext =
  | { kind: 'local'; cwd: string }
  | { kind: 'ssh'; label: string };

export interface CommandHistoryEntry {
  id: string;
  command: string;
  startedAt: number;
  durationMs: number;
  exitCode?: number;
  context: CommandHistoryContext;
}

const ENTRY_KEYS = new Set(['id', 'command', 'startedAt', 'durationMs', 'exitCode', 'context']);
const LOCAL_CONTEXT_KEYS = new Set(['kind', 'cwd']);
const SSH_CONTEXT_KEYS = new Set(['kind', 'label']);

type DataValues = Record<string, unknown>;

function ownDataValues(value: unknown, allowed: Set<string>): DataValues | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result: DataValues = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !('value' in descriptor)) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validatedContext(value: unknown): CommandHistoryContext | null {
  const values = ownDataValues(value, LOCAL_CONTEXT_KEYS);
  if (values?.kind === 'local') {
    return typeof values.cwd === 'string' && values.cwd.length > 0
      && values.cwd.length <= MAX_COMMAND_HISTORY_CWD_LENGTH
      ? { kind: 'local', cwd: values.cwd } : null;
  }
  const sshValues = ownDataValues(value, SSH_CONTEXT_KEYS);
  return sshValues?.kind === 'ssh'
    && typeof sshValues.label === 'string' && sshValues.label.length > 0
    && sshValues.label.length <= MAX_COMMAND_HISTORY_SSH_LABEL_LENGTH
    ? { kind: 'ssh', label: sshValues.label } : null;
}

function validatedEntry(value: unknown): CommandHistoryEntry | null {
  const entry = ownDataValues(value, ENTRY_KEYS);
  if (!entry) return null;
  const context = validatedContext(entry.context);
  if (typeof entry.id !== 'string' || entry.id.length === 0
    || entry.id.length > MAX_COMMAND_HISTORY_ID_LENGTH
    || typeof entry.command !== 'string' || entry.command.trim().length === 0
    || entry.command.length > MAX_COMMAND_HISTORY_COMMAND_LENGTH
    || !isSafeNonnegativeInteger(entry.startedAt)
    || !isSafeNonnegativeInteger(entry.durationMs)
    || (entry.exitCode !== undefined && !isSafeNonnegativeInteger(entry.exitCode))
    || !context) return null;
  try {
    structuredClone(value);
  } catch {
    return null;
  }
  return {
    id: entry.id, command: entry.command, startedAt: entry.startedAt,
    durationMs: entry.durationMs,
    ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }), context,
  };
}

export function cloneCommandHistoryEntry(entry: CommandHistoryEntry): CommandHistoryEntry {
  return {
    id: entry.id,
    command: entry.command,
    startedAt: entry.startedAt,
    durationMs: entry.durationMs,
    ...(entry.exitCode === undefined ? {} : { exitCode: entry.exitCode }),
    context: entry.context.kind === 'local'
      ? { kind: 'local', cwd: entry.context.cwd }
      : { kind: 'ssh', label: entry.context.label },
  };
}

export function cloneCommandHistory(entries: readonly CommandHistoryEntry[]): CommandHistoryEntry[] {
  return entries.map(cloneCommandHistoryEntry);
}

export function normalizeCommandHistory(value: unknown): CommandHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const entries: CommandHistoryEntry[] = [];
  for (const candidate of value) {
    const entry = validatedEntry(candidate);
    if (!entry || ids.has(entry.id)) continue;
    ids.add(entry.id);
    entries.push(entry);
    if (entries.length === MAX_COMMAND_HISTORY_ENTRIES) break;
  }
  return entries;
}

export function isValidCommandHistory(value: unknown): value is CommandHistoryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_COMMAND_HISTORY_ENTRIES) return false;
  const ids = new Set<string>();
  for (const candidate of value) {
    const entry = validatedEntry(candidate);
    if (!entry || ids.has(entry.id)) return false;
    ids.add(entry.id);
  }
  return true;
}

export function commandHistoryContextLabel(context: CommandHistoryContext): string {
  return context.kind === 'local' ? context.cwd : context.label;
}
