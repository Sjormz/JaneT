import { createHash } from 'crypto';
import {
  MAX_TEXT_FILE_BYTES,
  type TextFileRevision,
  type TextFileResult,
  textFileFailure,
} from '../shared/textFiles';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface DecodedTextFile {
  content: string;
  hasUtf8Bom: boolean;
}

export function decodeTextFile(bytes: Buffer): TextFileResult<DecodedTextFile> {
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
    return textFileFailure('TOO_LARGE', 'This file is larger than JaneT\'s 2 MiB editor limit.');
  }
  if (bytes.includes(0)) {
    return textFileFailure('BINARY', 'This file appears to be binary and cannot be opened in the text editor.');
  }

  const hasUtf8Bom = bytes.subarray(0, UTF8_BOM.byteLength).equals(UTF8_BOM);
  const body = hasUtf8Bom ? bytes.subarray(UTF8_BOM.byteLength) : bytes;
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return textFileFailure('INVALID_UTF8', 'This file is not valid UTF-8 text.');
  }

  let suspiciousControls = 0;
  let codePoints = 0;
  for (const character of content) {
    const code = character.codePointAt(0) ?? 0;
    codePoints += 1;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d) || code === 0x7f) {
      suspiciousControls += 1;
    }
  }
  if (suspiciousControls > 0 && suspiciousControls / Math.max(1, codePoints) > 0.01) {
    return textFileFailure('BINARY', 'This file contains binary control data and cannot be opened safely as text.');
  }

  return { ok: true, value: { content, hasUtf8Bom } };
}

export function encodeTextFile(content: unknown, hasUtf8Bom: unknown): TextFileResult<Buffer> {
  if (typeof content !== 'string' || typeof hasUtf8Bom !== 'boolean') {
    return textFileFailure('INVALID_REQUEST', 'A UTF-8 text value and BOM preference are required.');
  }
  const body = Buffer.from(content, 'utf8');
  const bytes = hasUtf8Bom ? Buffer.concat([UTF8_BOM, body]) : body;
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
    return textFileFailure('TOO_LARGE', 'This file is larger than JaneT\'s 2 MiB editor limit.');
  }
  return { ok: true, value: bytes };
}

export function textFileRevision(
  bytes: Buffer,
  metadata: { size: number; mtime: Date | string | number; fileId?: string },
): TextFileRevision {
  const timestamp = metadata.mtime instanceof Date
    ? metadata.mtime
    : new Date(metadata.mtime);
  return {
    token: createHash('sha256').update(bytes).digest('hex'),
    size: metadata.size,
    mtime: Number.isNaN(timestamp.getTime()) ? String(metadata.mtime) : timestamp.toISOString(),
    ...(metadata.fileId ? { fileId: metadata.fileId } : {}),
  };
}

export function revisionsMatch(left: TextFileRevision, right: TextFileRevision): boolean {
  return left.token === right.token
    && left.size === right.size
    && left.mtime === right.mtime
    && left.fileId === right.fileId;
}
