export const DEFAULT_TERMINAL_FONT_FAMILY = "'JetBrains Mono Variable', ui-monospace, 'SFMono-Regular', Menlo, Monaco, 'Cascadia Code', Consolas, monospace";

export const LEGACY_TERMINAL_FONT_FAMILY = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace";

/** Upgrade JaneT's former built-in stack without overwriting a custom family. */
export function normalizeTerminalFontFamily(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value === LEGACY_TERMINAL_FONT_FAMILY) {
    return DEFAULT_TERMINAL_FONT_FAMILY;
  }
  return value;
}
