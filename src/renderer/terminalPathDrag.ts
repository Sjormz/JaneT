export const TERMINAL_PATH_MIME = 'application/x-janet-terminal-path';

export type TerminalPathFilesystem =
  | { kind: 'local' }
  | { kind: 'ssh'; sessionId: string };

export interface TerminalPathDragPayload {
  version: 1;
  path: string;
  entryKind: 'file' | 'directory';
  origin: 'explorer' | 'source-control';
  filesystem: TerminalPathFilesystem;
}

export type TerminalPathDropTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; sessionId?: string };

const MAX_TERMINAL_PATH_LENGTH = 32_768;
const UNSAFE_TERMINAL_PATH = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const UNQUOTED_POSIX_PATH = /^[A-Za-z0-9_@%+=:,./-]+$/;
let activeTerminalPathDrag: TerminalPathDragPayload | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeTerminalPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_TERMINAL_PATH_LENGTH
    && !UNSAFE_TERMINAL_PATH.test(value);
}

function isTerminalPathFilesystem(value: unknown): value is TerminalPathFilesystem {
  if (!isRecord(value)) return false;
  if (value.kind === 'local') return true;
  return value.kind === 'ssh' && isSafeTerminalPath(value.sessionId);
}

function isTerminalPathDragPayload(value: unknown): value is TerminalPathDragPayload {
  return isRecord(value)
    && value.version === 1
    && isSafeTerminalPath(value.path)
    && (value.entryKind === 'file' || value.entryKind === 'directory')
    && (value.origin === 'explorer' || value.origin === 'source-control')
    && isTerminalPathFilesystem(value.filesystem);
}

export function beginTerminalPathDrag(
  dataTransfer: DataTransfer,
  payload: TerminalPathDragPayload,
): boolean {
  activeTerminalPathDrag = null;
  if (!isTerminalPathDragPayload(payload)) return false;
  dataTransfer.setData(TERMINAL_PATH_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.path);
  dataTransfer.effectAllowed = 'copy';
  activeTerminalPathDrag = payload;
  return true;
}

export function endTerminalPathDrag(): void {
  activeTerminalPathDrag = null;
}

export function getActiveTerminalPathDrag(): TerminalPathDragPayload | null {
  return activeTerminalPathDrag;
}

export function hasTerminalPathDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes(TERMINAL_PATH_MIME);
}

export function readTerminalPathDragData(dataTransfer: DataTransfer): TerminalPathDragPayload | null {
  try {
    const encoded = dataTransfer.getData(TERMINAL_PATH_MIME);
    if (!encoded) return null;
    const parsed: unknown = JSON.parse(encoded);
    return isTerminalPathDragPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function canDropTerminalPath(
  payload: TerminalPathDragPayload,
  target: TerminalPathDropTarget,
): boolean {
  if (target.kind === 'local') return payload.filesystem.kind === 'local';
  return payload.filesystem.kind === 'ssh'
    && Boolean(target.sessionId)
    && payload.filesystem.sessionId === target.sessionId;
}

export function formatTerminalPathForPaste(
  path: string,
  dialect?: 'posix' | 'fish' | 'powershell',
): string | null {
  if (!isSafeTerminalPath(path)) return null;
  const inferredDialect = dialect
    ?? (/^(?:[A-Za-z]:[\\/]|\\\\)/.test(path) ? 'powershell' : 'posix');

  if (inferredDialect === 'powershell') {
    return `'${path.replace(/['\u2018\u2019]/g, (quote) => `${quote}${quote}`)}' `;
  }
  if (UNQUOTED_POSIX_PATH.test(path)) return `${path} `;
  if (inferredDialect === 'fish') {
    return `'${path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' `;
  }
  return `'${path.split("'").join("'\\''")}' `;
}

export function resolveRepositoryPath(repoPath: string, relativePath: string): string {
  const windowsRoot = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(repoPath);
  if (windowsRoot && /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(relativePath)) return relativePath;
  if (!windowsRoot && relativePath.startsWith('/')) return relativePath;
  const separator = windowsRoot && repoPath.includes('\\') ? '\\' : '/';
  const root = windowsRoot
    ? repoPath.replace(/[\\/]+$/, '')
    : repoPath.replace(/\/+$/, '');
  const relative = windowsRoot
    ? relativePath.replace(/^[\\/]+/, '').replace(/\//g, separator)
    : relativePath.replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!relative) return repoPath;
  if (!root) return `${separator}${relative}`;
  return `${root}${separator}${relative}`;
}
