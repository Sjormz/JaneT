// Keyboard shortcut defaults and migration shared by the main process
// (settings persistence) and the renderer (matching and display). This module
// must stay free of DOM, React, and Electron imports.
//
// See docs/shortcut-audit-2026-09-28.md for the conflict audit behind these
// defaults. On Windows and Linux, application actions use Ctrl+Shift chords:
// xterm.js sends nothing to the shell for Ctrl+Shift+letter, so these never
// shadow readline, vim, emacs, nano, tmux, or TUI keys. Ctrl+Alt is avoided
// because it is AltGr on many European layouts. On macOS, actions use Command,
// which terminal programs never receive.

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

/** Windows and Linux defaults. */
export const DEFAULT_KEYBINDINGS: Readonly<Record<KeybindingAction, string>> = Object.freeze({
  'search-toggle': 'Ctrl+Shift+F',
  'palette-toggle': 'Ctrl+Shift+P',
  'new-terminal': 'Ctrl+Shift+T',
  'close-tab': 'Ctrl+Shift+W',
  'settings-toggle': 'Ctrl+,',
  'toggle-sidebar': 'Ctrl+Shift+B',
  'font-increase': 'Ctrl+Plus',
  'font-decrease': 'Ctrl+-',
  'font-reset': 'Ctrl+0',
  'previous-tab': 'Ctrl+Shift+Tab',
  'next-tab': 'Ctrl+Tab',
  'snippets-toggle': '',
  'history-toggle': '',
  'split-right': 'Ctrl+Shift+5',
  'split-down': "Ctrl+Shift+'",
  'close-pane': '',
  'maximize-pane': '',
  'focus-next-pane': '',
  'focus-previous-pane': '',
  'move-pane-left': '',
  'move-pane-right': '',
  'move-pane-up': '',
  'move-pane-down': '',
  'rename-pane': 'Ctrl+Shift+F2',
  'rename-tab': 'Ctrl+Shift+I',
  'save-document': '',
  'close-document': '',
  'previous-command': 'Ctrl+Shift+ArrowUp',
  'next-command': 'Ctrl+Shift+ArrowDown',
  'copy-command': 'Ctrl+Shift+K',
  'copy-command-output': 'Ctrl+Shift+O',
  'rerun-command': 'Ctrl+Shift+R',
});

/** macOS overrides of the Windows and Linux defaults. */
const MAC_KEYBINDINGS: Readonly<Partial<Record<KeybindingAction, string>>> = Object.freeze({
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
  'rename-pane': 'Meta+Shift+F2',
  'rename-tab': 'Meta+F2',
  'previous-command': 'Meta+ArrowUp',
  'next-command': 'Meta+ArrowDown',
  'copy-command': 'Meta+Alt+C',
  'copy-command-output': 'Meta+Alt+O',
  'rerun-command': 'Meta+Alt+R',
});

export const KEYBINDING_ACTIONS = Object.freeze(Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]);

export function defaultKeybindingsForPlatform(platform: string): Record<KeybindingAction, string> {
  return platform === 'darwin'
    ? { ...DEFAULT_KEYBINDINGS, ...MAC_KEYBINDINGS }
    : { ...DEFAULT_KEYBINDINGS };
}

// === Migration from earlier defaults ===

/**
 * Settings key recording which default-shortcut generation a stored map was
 * written against. It lives inside the stored keybinding record so the
 * settings schema does not change, and is never exposed to the renderer.
 */
export const KEYBINDINGS_SCHEMA_KEY = '$keybindingsSchema';
export const KEYBINDINGS_SCHEMA_VERSION = '2';

/** Windows and Linux defaults shipped before the 2026-09-28 shortcut audit. */
const SCHEMA_1_DEFAULT_KEYBINDINGS: Readonly<Record<KeybindingAction, string>> = Object.freeze({
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
});

/** macOS overrides shipped before the 2026-09-28 shortcut audit. */
const SCHEMA_1_MAC_KEYBINDINGS: Readonly<Partial<Record<KeybindingAction, string>>> = Object.freeze({
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
});

/** The earliest sparse default map, before per-platform defaults existed. */
const LEGACY_KEYBINDINGS: Readonly<Record<string, string>> = Object.freeze({
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
  'rename-pane': 'F2',
  'rename-tab': 'Ctrl+F2',
  'previous-command': 'Ctrl+Shift+ArrowUp',
  'next-command': 'Ctrl+Shift+ArrowDown',
  'copy-command': 'Ctrl+Alt+C',
  'copy-command-output': 'Ctrl+Alt+O',
  'rerun-command': 'Ctrl+Alt+R',
});

function schema1DefaultsForPlatform(platform: string): Record<string, string> {
  return platform === 'darwin'
    ? { ...SCHEMA_1_DEFAULT_KEYBINDINGS, ...SCHEMA_1_MAC_KEYBINDINGS }
    : { ...SCHEMA_1_DEFAULT_KEYBINDINGS };
}

function exactlyMatches(record: Record<string, string>, expected: Record<string, string>): boolean {
  const keys = Object.keys(record);
  return keys.length === Object.keys(expected).length
    && keys.every((key) => Object.hasOwn(expected, key) && record[key] === expected[key]);
}

/** Every value an action has shipped with by default on this platform before schema 2. */
function earlierDefaultsFor(action: string, platform: string): Set<string> {
  const values = new Set<string>();
  const current = schema1DefaultsForPlatform(platform) as Record<string, string>;
  if (Object.hasOwn(current, action)) values.add(current[action]);
  // Before macOS had its own defaults, a Mac saved the Ctrl-based map.
  if (platform === 'darwin' && Object.hasOwn(SCHEMA_1_DEFAULT_KEYBINDINGS, action)) {
    values.add(SCHEMA_1_DEFAULT_KEYBINDINGS[action as KeybindingAction]);
  }
  // The earliest sparse defaults (such as Ctrl+K for the palette) on every platform.
  if (Object.hasOwn(LEGACY_KEYBINDINGS, action)) values.add(LEGACY_KEYBINDINGS[action]);
  return values;
}

/**
 * Bring a stored keybinding map up to the current default generation.
 *
 * - A map already written against the current schema is returned unchanged.
 * - An untouched legacy map (the historical exact-match cases) becomes the
 *   current defaults.
 * - Otherwise each binding that still equals a default this platform shipped
 *   earlier moves to its new default, and every binding the user changed is
 *   kept. If a moved default would collide with a customized binding, the
 *   moved action is left unassigned so the user's choice keeps working.
 *
 * The result never contains the schema key; callers add it when persisting.
 */
export function migrateKeybindings(
  stored: Record<string, string>,
  platform: string,
): Record<string, string> {
  const defaults = defaultKeybindingsForPlatform(platform);
  const { [KEYBINDINGS_SCHEMA_KEY]: schema, ...bindings } = stored;
  if (schema === KEYBINDINGS_SCHEMA_VERSION) return bindings;

  const schema1 = schema1DefaultsForPlatform(platform);
  const schema1WithoutMovePane = Object.fromEntries(
    Object.entries(schema1).filter(([action]) => !action.startsWith('move-pane-')),
  );
  if (
    exactlyMatches(bindings, LEGACY_KEYBINDINGS)
    || exactlyMatches(bindings, { ...schema1, ...LEGACY_KEYBINDINGS })
    || exactlyMatches(bindings, { ...schema1WithoutMovePane, ...LEGACY_KEYBINDINGS })
  ) return {};

  const migrated: Record<string, string> = { ...bindings };
  const moved = new Set<string>();
  for (const action of KEYBINDING_ACTIONS) {
    // An action missing from an older map receives its new default too.
    if (Object.hasOwn(bindings, action) && !earlierDefaultsFor(action, platform).has(bindings[action])) continue;
    migrated[action] = defaults[action];
    moved.add(action);
  }
  // A customized binding wins over a moved default that now shares its chord.
  const customized = new Set(
    Object.entries(migrated)
      .filter(([action, value]) => value && !moved.has(action))
      .map(([, value]) => normalizeShortcutText(value)),
  );
  for (const action of moved) {
    if (migrated[action] && customized.has(normalizeShortcutText(migrated[action]))) migrated[action] = '';
  }
  return migrated;
}

/** Order-insensitive, case-insensitive form of a stored shortcut for comparison. */
export function normalizeShortcutText(shortcut: string): string {
  if (!shortcut) return '';
  const parts = shortcut.split('+');
  const modifiers = new Set<string>();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'shift' || lower === 'alt' || lower === 'meta') modifiers.add(lower);
    else key = lower === '=' ? 'plus' : lower;
  }
  return [...['ctrl', 'alt', 'shift', 'meta'].filter((modifier) => modifiers.has(modifier)), key].join('+');
}
