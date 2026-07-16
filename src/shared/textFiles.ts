export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

export type TextFileErrorCode =
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'NOT_FILE'
  | 'TOO_LARGE'
  | 'BINARY'
  | 'INVALID_UTF8'
  | 'PERMISSION_DENIED'
  | 'CONFLICT'
  | 'STALE_SSH_SESSION'
  | 'SAFE_REPLACE_UNAVAILABLE'
  | 'IO';

export interface TextFileError {
  code: TextFileErrorCode;
  message: string;
}

export type TextFileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TextFileError };

export interface TextFileRevision {
  /** Opaque SHA-256 digest of the exact on-disk bytes. */
  token: string;
  size: number;
  mtime: string;
  /** Local device/inode identity when the platform exposes it. */
  fileId?: string;
}

export interface TextFileSnapshot {
  requestedPath: string;
  resolvedPath: string;
  content: string;
  encoding: 'utf8';
  hasUtf8Bom: boolean;
  revision: TextFileRevision;
}

export interface TextFileWriteValue {
  requestedPath: string;
  resolvedPath: string;
  revision: TextFileRevision;
}

export interface ReadLocalTextFileRequest {
  filePath: string;
}

export interface WriteLocalTextFileRequest {
  requestedPath: string;
  resolvedPath: string;
  expectedRevision: TextFileRevision;
  content: string;
  hasUtf8Bom: boolean;
  overwrite?: boolean;
}

export interface ReadSSHTextFileRequest {
  sessionId: string;
  connectionId: string;
  remotePath: string;
}

export interface WriteSSHTextFileRequest {
  sessionId: string;
  connectionId: string;
  requestedPath: string;
  resolvedPath: string;
  expectedRevision: TextFileRevision;
  content: string;
  hasUtf8Bom: boolean;
  overwrite?: boolean;
}

export function textFileFailure<T = never>(
  code: TextFileErrorCode,
  message: string,
): TextFileResult<T> {
  return { ok: false, error: { code, message } };
}

export function isTextFileRevision(value: unknown): value is TextFileRevision {
  if (!value || typeof value !== 'object') return false;
  const revision = value as Partial<TextFileRevision>;
  return (
    typeof revision.token === 'string'
    && /^[a-f0-9]{64}$/.test(revision.token)
    && typeof revision.size === 'number'
    && Number.isSafeInteger(revision.size)
    && revision.size >= 0
    && revision.size <= MAX_TEXT_FILE_BYTES
    && typeof revision.mtime === 'string'
    && revision.mtime.length > 0
    && (revision.fileId === undefined || (typeof revision.fileId === 'string' && revision.fileId.length > 0))
  );
}
