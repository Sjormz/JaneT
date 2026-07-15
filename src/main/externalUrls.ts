const allowedProtocols = new Set(['http:', 'https:']);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    return allowedProtocols.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
