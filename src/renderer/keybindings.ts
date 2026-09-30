// === Keybinding types and utilities ===

import type { KeybindingAction } from '../shared/keybindings';

export type { KeybindingAction } from '../shared/keybindings';
export {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_ACTIONS,
  defaultKeybindingsForPlatform,
  normalizeShortcutText,
} from '../shared/keybindings';

export interface ParsedShortcut {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export const KEYBINDING_LABELS: Record<KeybindingAction, string> = {
  'search-toggle': 'Search terminal output',
  'palette-toggle': 'Open command palette',
  'new-terminal': 'New terminal tab',
  'close-tab': 'Close current terminal',
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

/** Unshifted US-layout character for each physical key that produces printable ASCII. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [`Digit${digit}`, String(digit)])),
  ...Object.fromEntries(Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(97 + index);
    return [`Key${letter.toUpperCase()}`, letter];
  })),
};

/** The character Shift produces for each US-layout digit or punctuation key. */
const US_SHIFTED: Readonly<Record<string, string>> = {
  '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?',
};

type ShortcutKeyEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;

/**
 * The key a shortcut names for this event, independent of what Shift or the
 * keyboard layout did to `KeyboardEvent.key`.
 *
 * - Shift+punctuation reports the shifted glyph (`Ctrl+Shift+\` arrives as
 *   `|` on US-style layouts); when the layout agrees with US for that key, use
 *   the unshifted key the shortcut is written with.
 * - A non-Latin layout (or macOS Option) reports a character outside ASCII;
 *   use the physical key so `Ctrl+Shift+F` still works on a Cyrillic layout.
 * - Ctrl+Alt without Meta is AltGr on Windows and Linux, so a character it
 *   types is never reinterpreted as a shortcut letter.
 */
export function shortcutKeyFromEvent(e: ShortcutKeyEvent): string {
  const key = e.key ?? '';
  const codeKey = CODE_KEYS[e.code ?? ''];
  const altGraph = e.ctrlKey && e.altKey && !e.metaKey;
  if (key.length === 1) {
    if (e.shiftKey && codeKey && US_SHIFTED[codeKey] === key) return codeKey;
    const printableAscii = key >= ' ' && key <= '~';
    if (!printableAscii && codeKey && !altGraph) return codeKey;
    return key;
  }
  if ((key === 'Dead' || key === 'Unidentified') && codeKey && !altGraph) return codeKey;
  return key;
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
      case 'space': result.key = ' '; break;
      default: result.key = part; break;
    }
  }

  return result;
}

/** Check if a KeyboardEvent matches a shortcut string */
export function matchesShortcut(e: ShortcutKeyEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  const parsed = parseShortcut(shortcut);
  if (!parsed.key) return false;
  const eventKey = shortcutKeyFromEvent(e);
  // "Plus" is the = key or a key that types + directly (numpad, German layout,
  // or Shift+= on US), so Shift does not change which Plus shortcut it is.
  const plusKey = parsed.key === '=' && !parsed.shiftKey && (e.key === '+' || eventKey === '=');
  const keyMatch = plusKey || eventKey.toLowerCase() === parsed.key.toLowerCase();
  return (
    keyMatch &&
    e.ctrlKey === parsed.ctrlKey &&
    (plusKey ? true : e.shiftKey === parsed.shiftKey) &&
    e.altKey === parsed.altKey &&
    e.metaKey === parsed.metaKey
  );
}

/** Format a KeyboardEvent into a shortcut string (for display / saving) */
export function formatShortcut(e: ShortcutKeyEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  // Map special key names to readable form
  const keyMap: Record<string, string> = {
    '=': 'Plus',
    '+': 'Plus',
    ' ': 'Space',
  };
  const eventKey = shortcutKeyFromEvent(e);
  const keyName = keyMap[eventKey] || eventKey;
  // Capitalize single-letter keys
  const formattedKey = keyName.length === 1 ? keyName.toUpperCase() : keyName;
  parts.push(formattedKey);

  return parts.join('+');
}

/**
 * Terminal paste keys, following each platform's terminal convention:
 * Ctrl+Shift+V and Shift+Insert everywhere; Ctrl+V also on Windows (Windows
 * Terminal, PowerShell); Cmd+V on macOS. Plain Ctrl+V on Linux and macOS goes
 * to the terminal program (quoted insert, vim block selection).
 */
export function isTerminalPasteChord(e: ShortcutKeyEvent, platform: string): boolean {
  if (e.altKey) return false;
  if (e.key === 'Insert') return e.shiftKey && !e.ctrlKey && !e.metaKey;
  if (shortcutKeyFromEvent(e).toLowerCase() !== 'v') return false;
  // Command (or Windows/Super) never reaches the terminal program.
  if (e.metaKey) return !e.ctrlKey;
  if (!e.ctrlKey) return false;
  return e.shiftKey || platform === 'win32';
}

/**
 * Terminal copy keys. They copy only while text is selected; otherwise the key
 * reaches the terminal. Ctrl+Shift+C everywhere; Ctrl+C with a selection on
 * Windows and Linux (Windows Terminal and VS Code convention); Cmd+C on macOS,
 * where Ctrl+C always interrupts.
 */
export function isTerminalCopyChord(e: ShortcutKeyEvent, platform: string): boolean {
  if (e.altKey || shortcutKeyFromEvent(e).toLowerCase() !== 'c') return false;
  if (e.metaKey) return !e.ctrlKey;
  if (!e.ctrlKey) return false;
  return e.shiftKey || platform !== 'darwin';
}

const CONTROL_KEY_USES:Readonly<Record<string, string>> = {
  a: 'move to start of line', b: 'move back a character, and the tmux prefix', c: 'interrupt',
  d: 'end of input or exit', e: 'move to end of line', f: 'move forward a character',
  g: 'cancel', h: 'backspace', i: 'Tab', j: 'newline', k: 'delete to end of line',
  l: 'clear the screen', m: 'Enter', n: 'next history entry', o: 'run and fetch next history entry',
  p: 'previous history entry', q: 'resume output', r: 'reverse history search',
  s: 'forward history search or stop output', t: 'swap characters', u: 'delete to start of line',
  v: 'insert the next key literally, and vim block selection', w: 'delete the previous word',
  x: 'the Emacs and readline prefix', y: 'paste deleted text', z: 'suspend the running program',
};

const CONTROL_CHARACTER_KEYS = new Set(['[', '\\', ']', '/', '2', '3', '4', '5', '6', '7', '8', ' ']);

/**
 * A warning for a shortcut that shadows keys terminal programs, keyboard
 * layouts, or the operating system need, or null when it is safe to assign.
 * Terminal shortcuts are captured before the shell sees them, so these keys
 * would stop working in every terminal.
 */
export function shortcutConflict(shortcut: string, platform = rendererPlatform()): string | null {
  if (!shortcut) return null;
  const parsed = parseShortcut(shortcut);
  const key = parsed.key.toLowerCase();
  if (!key) return null;
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta } = parsed;
  const letter = /^[a-z]$/.test(key);
  const functionKey = /^f(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
  const printable = key.length === 1;
  const display = formatShortcutForDisplay(shortcut, platform);
  const mac = platform === 'darwin';

  if (mac) {
    if (meta && !ctrl && !alt && ['q', 'h', 'm', 'tab', ' ', '`'].includes(key)) {
      return `${display} is reserved by macOS.`;
    }
    if (meta && !ctrl && !alt && !shift && ['c', 'v'].includes(key)) {
      return `${display} copies and pastes in terminals, so it will not run this action there.`;
    }
    if (meta && shift && !ctrl && !alt && ['3', '4', '5'].includes(key)) return `${display} takes screenshots in macOS.`;
    if (ctrl && !meta && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
      return `${display} is reserved by macOS for Mission Control or input sources.`;
    }
  } else {
    if (meta) return `${display} uses the ${platform === 'win32' ? 'Windows' : 'Super'} key, which the operating system reserves.`;
    if ((alt && !ctrl && ['f4', 'tab'].includes(key)) || (ctrl && ['escape'].includes(key))
      || (ctrl && alt && (key === 'delete' || functionKey))) {
      return `${display} is reserved by the operating system.`;
    }
    if (ctrl && !alt && ['c', 'v'].includes(key)) {
      return `${display} copies, pastes, or interrupts in terminals, so it will not run this action there.`;
    }
    if (ctrl && alt && printable) {
      return `${display} is AltGr on many keyboard layouts, so it can block typing characters such as @, € or {.`;
    }
    if (ctrl && shift && !alt && ['-', '2', '6'].includes(key)) {
      return `${display} sends a control character that shells and editors use, such as Ctrl+_ for undo.`;
    }
  }

  if (ctrl && !shift && !alt && !meta && letter) {
    return `${display} is a terminal key (${CONTROL_KEY_USES[key]}). Shells and terminal programs will stop receiving it.`;
  }
  if (ctrl && !shift && !alt && !meta && CONTROL_CHARACTER_KEYS.has(key)) {
    return `${display} sends a control character, such as Ctrl+\\ to quit a program or Ctrl+[ for Escape.`;
  }
  if (alt && !ctrl && !meta && printable) {
    return mac
      ? `${display} types special characters, and is Meta for terminal programs when Option is used as Meta.`
      : `${display} is Meta in shells and Emacs, such as Alt+B and Alt+F to move by word.`;
  }
  if (functionKey && !ctrl && !alt && !meta) {
    return `${display} is used by terminal programs such as htop and Midnight Commander.`;
  }
  return null;
}

/** The platform this renderer runs on, for display and platform conventions such as terminal paste keys. */
export function rendererPlatform(): 'darwin' | 'win32' | 'linux' {
  const value = typeof navigator === 'undefined' ? '' : navigator.platform;
  if (/Mac|iPhone|iPad/i.test(value)) return 'darwin';
  if (/Win/i.test(value)) return 'win32';
  return 'linux';
}

/** A saved shortcut as one label per key, using the modifier glyphs on macOS. Empty for an unassigned shortcut. */
export function shortcutKeycaps(shortcut: string, platform = ''): string[] {
  if (!shortcut) return [];
  const mac = platform === 'darwin';
  const names: Record<string, string> = {
    Plus: '+', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ...(mac ? { Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↩', Backspace: '⌫', Escape: 'esc' } : {}),
  };
  return shortcut.split('+').map((part) => names[part] ?? part);
}

/** Render a saved shortcut using the conventions of the current platform. */
export function formatShortcutForDisplay(shortcut: string, platform = ''): string {
  if (platform !== 'darwin') return shortcut.replace(/\bPlus\b/g, '+');
  return shortcut
    .split('+')
    .map((part) => ({ Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Plus: '+' })[part] ?? part)
    .join('');
}
