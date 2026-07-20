// === Keybinding types and utilities ===

export interface ParsedShortcut {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type KeybindingAction =
  | 'search-toggle'
  | 'palette-toggle'
  | 'new-terminal'
  | 'close-tab'
  | 'toggle-sidebar'
  | 'font-increase'
  | 'font-decrease'
  | 'snippets-toggle'
  | 'split-right'
  | 'split-down'
  | 'close-pane';

export const KEYBINDING_LABELS: Record<KeybindingAction, string> = {
  'search-toggle': 'Search terminal output',
  'palette-toggle': 'Open command palette',
  'new-terminal': 'New terminal tab',
  'close-tab': 'Close current tab',
  'toggle-sidebar': 'Show or hide workspace tools',
  'font-increase': 'Increase terminal text size',
  'font-decrease': 'Decrease terminal text size',
  'snippets-toggle': 'Open snippets',
  'split-right': 'Split pane right',
  'split-down': 'Split pane below',
  'close-pane': 'Close current pane',
};

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
  'search-toggle': 'Ctrl+F',
  'palette-toggle': 'Ctrl+K',
  'new-terminal': 'Ctrl+N',
  'close-tab': 'Ctrl+W',
  'toggle-sidebar': 'Ctrl+B',
  'font-increase': 'Ctrl+Plus',
  'font-decrease': 'Ctrl+-',
  'snippets-toggle': 'Ctrl+Shift+P',
  'split-right': 'Ctrl+\\',
  'split-down': 'Ctrl+Shift+\\',
  'close-pane': 'Ctrl+Shift+W',
};

/** Parse a shortcut string like "Ctrl+Shift+F" into a match object */
export function parseShortcut(shortcut: string): ParsedShortcut {
  const parts = shortcut.split('+');
  const result: ParsedShortcut = {
    key: '',
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
  };

  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'ctrl': result.ctrlKey = true; break;
      case 'shift': result.shiftKey = true; break;
      case 'alt': result.altKey = true; break;
      case 'meta': result.metaKey = true; break;
      case 'plus': result.key = '='; break;  // = is the actual key for +
      default: result.key = part; break;
    }
  }

  return result;
}

/** Check if a KeyboardEvent matches a shortcut string */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  const keyMatch = e.key.toLowerCase() === parsed.key.toLowerCase();
  return (
    keyMatch &&
    e.ctrlKey === parsed.ctrlKey &&
    e.shiftKey === parsed.shiftKey &&
    e.altKey === parsed.altKey &&
    e.metaKey === parsed.metaKey
  );
}

/** Format a KeyboardEvent into a shortcut string (for display / saving) */
export function formatShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  // Map special key names to readable form
  const keyMap: Record<string, string> = {
    '=': 'Plus',
    '-': '-',
    ' ': 'Space',
    '\\': '\\',
  };
  const keyName = keyMap[e.key] || e.key;
  // Capitalize single-letter keys
  const formattedKey = keyName.length === 1 ? keyName.toUpperCase() : keyName;
  parts.push(formattedKey);

  return parts.join('+');
}

/** Render a saved shortcut using the conventions of the current platform. */
export function formatShortcutForDisplay(shortcut: string, platform = ''): string {
  if (platform !== 'darwin') return shortcut.replace(/\bPlus\b/g, '+');
  return shortcut
    .split('+')
    .map((part) => ({ Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Plus: '+' })[part] ?? part)
    .join('');
}
