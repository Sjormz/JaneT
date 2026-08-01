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

function exactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isValidContext(value: unknown): value is CommandHistoryContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  if (context.kind === 'local') {
    return exactKeys(context, LOCAL_CONTEXT_KEYS)
      && typeof context.cwd === 'string' && context.cwd.length > 0
      && context.cwd.length <= MAX_COMMAND_HISTORY_CWD_LENGTH;
  }
  return context.kind === 'ssh'
    && exactKeys(context, SSH_CONTEXT_KEYS)
    && typeof context.label === 'string' && context.label.length > 0
    && context.label.length <= MAX_COMMAND_HISTORY_SSH_LABEL_LENGTH;
}

function isValidEntry(value: unknown): value is CommandHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return exactKeys(entry, ENTRY_KEYS)
    && typeof entry.id === 'string' && entry.id.length > 0
    && entry.id.length <= MAX_COMMAND_HISTORY_ID_LENGTH
    && typeof entry.command === 'string' && entry.command.trim().length > 0
    && entry.command.length <= MAX_COMMAND_HISTORY_COMMAND_LENGTH
    && isSafeNonnegativeInteger(entry.startedAt)
    && isSafeNonnegativeInteger(entry.durationMs)
    && (entry.exitCode === undefined || isSafeNonnegativeInteger(entry.exitCode))
    && isValidContext(entry.context);
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
  for (const candidate of value.slice(0, MAX_COMMAND_HISTORY_ENTRIES)) {
    if (!isValidEntry(candidate) || ids.has(candidate.id)) continue;
    ids.add(candidate.id);
    entries.push(cloneCommandHistoryEntry(candidate));
  }
  return entries;
}

export function isValidCommandHistory(value: unknown): value is CommandHistoryEntry[] {
  if (!Array.isArray(value) || value.length > MAX_COMMAND_HISTORY_ENTRIES) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (!isValidEntry(entry) || ids.has(entry.id)) return false;
    ids.add(entry.id);
    return true;
  });
}

export function commandHistoryContextLabel(context: CommandHistoryContext): string {
  return context.kind === 'local' ? context.cwd : context.label;
}
