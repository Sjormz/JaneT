const MAX_CLIPBOARD_BYTES = 1_048_576;

export function decodeTerminalClipboard(data: string): string | null {
  const separator = data.indexOf(';');
  if (separator < 0 || !['', 'c', 'p', 's', 'cp'].includes(data.slice(0, separator))) return null;
  const encoded = data.slice(separator + 1);
  // Never answer OSC 52 reads. Do not retain unbounded or malformed payloads.
  if (!encoded || encoded === '?' || encoded.length > Math.ceil(MAX_CLIPBOARD_BYTES / 3) * 4
    || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (bytes.length > MAX_CLIPBOARD_BYTES) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}
