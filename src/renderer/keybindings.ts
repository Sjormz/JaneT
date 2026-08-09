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
  | 'settings-toggle'
  | 'toggle-sidebar'
  | 'font-increase'
  | 'font-decrease'
  | 'font-reset'
  | 'previous-tab'
  | 'next-tab'
  | 'snippets-toggle'
  | 'history-toggle'
  | 'split-right'
  | 'split-down'
  | 'close-pane'
  | 'maximize-pane'
  | 'focus-next-pane'
  | 'focus-previous-pane'
  | 'move-pane-left'
  | 'move-pane-right'
  | 'move-pane-up'
  | 'move-pane-down'
  | 'rename-pane'
  | 'rename-tab'
  | 'save-document'
  | 'close-document'
  | 'previous-command'
  | 'next-command'
  | 'copy-command'
  | 'copy-command-output'
  | 'rerun-command';

export const KEYBINDING_LABELS: Record<KeybindingAction, string> = {
  'search-toggle': 'Search terminal output',
  'palette-toggle': 'Open command palette',
  'new-terminal': 'New terminal tab',
  'close-tab': 'Close current tab',
  'settings-toggle': 'Open settings',
  'toggle-sidebar': 'Show or hide workspace tools',
  'font-increase': 'Increase terminal text size',
  'font-decrease': 'Decrease terminal text size',
  'font-reset': 'Reset terminal text size',
  'previous-tab': 'Previous terminal tab',
  'next-tab': 'Next terminal tab',
  'snippets-toggle': 'Open snippets',
  'history-toggle': 'Open command history',
  'split-right': 'Split pane right',
  'split-down': 'Split pane below',
  'close-pane': 'Close current pane',
  'maximize-pane': 'Maximize or restore current pane',
  'focus-next-pane': 'Focus next pane',
  'focus-previous-pane': 'Focus previous pane',
  'move-pane-left': 'Move current pane left',
  'move-pane-right': 'Move current pane right',
  'move-pane-up': 'Move current pane up',
  'move-pane-down': 'Move current pane down',
  'rename-pane': 'Rename current terminal',
  'rename-tab': 'Rename current tab',
  'save-document': 'Save current document',
  'close-document': 'Close current document',
  'previous-command': 'Previous semantic command',
  'next-command': 'Next semantic command',
  'copy-command': 'Copy semantic command',
  'copy-command-output': 'Copy semantic command output',
  'rerun-command': 'Paste semantic command for rerun',
};

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
  'search-toggle': 'Ctrl+F',
  'palette-toggle': 'Ctrl+Shift+P',
  'new-terminal': 'Ctrl+Shift+T',
  'close-tab': 'Ctrl+W',
  'settings-toggle': 'Ctrl+,',
  'toggle-sidebar': 'Ctrl+B',
  'font-increase': 'Ctrl+Plus',
  'font-decrease': 'Ctrl+-',
  'font-reset': 'Ctrl+0',
  'previous-tab': 'Ctrl+Shift+Tab',
  'next-tab': 'Ctrl+Tab',
  'snippets-toggle': '',
  'history-toggle': '',
  'split-right': 'Ctrl+\\',
  'split-down': 'Ctrl+Shift+\\',
  'close-pane': 'Ctrl+Shift+W',
  'maximize-pane': '',
  'focus-next-pane': '',
  'focus-previous-pane': '',
  'move-pane-left': '',
  'move-pane-right': '',
  'move-pane-up': '',
  'move-pane-down': '',
  'rename-pane': 'F2',
  'rename-tab': 'Ctrl+F2',
  'save-document': '',
  'close-document': '',
  'previous-command': 'Ctrl+Shift+ArrowUp',
  'next-command': 'Ctrl+Shift+ArrowDown',
  'copy-command': 'Ctrl+Alt+C',
  'copy-command-output': 'Ctrl+Alt+O',
  'rerun-command': 'Ctrl+Alt+R',
};

export function defaultKeybindingsForPlatform(platform: string): Record<KeybindingAction, string> {
  if (platform !== 'darwin') return { ...DEFAULT_KEYBINDINGS };
  return {
    ...DEFAULT_KEYBINDINGS,
    'search-toggle': 'Meta+F',
    'palette-toggle': 'Meta+Shift+P',
    'new-terminal': 'Meta+T',
    'close-tab': 'Meta+W',
    'settings-toggle': 'Meta+,',
    'toggle-sidebar': 'Meta+B',
    'font-increase': 'Meta+Plus',
    'font-decrease': 'Meta+-',
    'font-reset': 'Meta+0',
    'split-right': 'Meta+\\',
    'split-down': 'Meta+Shift+\\',
    'close-pane': 'Meta+Shift+W',
    'rename-tab': 'Meta+F2',
  };
}

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
  if (!shortcut) return false;
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
