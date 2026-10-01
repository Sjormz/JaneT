import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_LABELS,
  defaultKeybindingsForPlatform,
  formatShortcut,
  isTerminalCopyChord,
  isTerminalPasteChord,
  matchesShortcut,
  parseShortcut,
  shortcutConflict,
  type KeybindingAction,
} from '../../src/renderer/keybindings';
import {
  KEYBINDINGS_SCHEMA_KEY,
  KEYBINDINGS_SCHEMA_VERSION,
  migrateKeybindings,
} from '../../src/shared/keybindings';

type KeyInit = Partial<Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>>;

/** A keydown as Chromium reports it on a US layout unless the test overrides `key`. */
function keydown(init: KeyInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...init });
}

const PLATFORMS = ['win32', 'linux', 'darwin'] as const;

describe('keyboard shortcut defaults', () => {
  it('uses Ctrl+Shift chords on Windows and Linux so shell and TUI keys reach the terminal', () => {
    expect(DEFAULT_KEYBINDINGS).toMatchObject({
      'search-toggle': 'Ctrl+Shift+F',
      'palette-toggle': 'Ctrl+Shift+P',
      'new-terminal': 'Ctrl+Shift+T',
      'add-terminals': 'Ctrl+Shift+`',
      'close-tab': 'Ctrl+Shift+W',
      'settings-toggle': 'Ctrl+,',
      'toggle-sidebar': 'Ctrl+Shift+B',
      'font-reset': 'Ctrl+0',
      'previous-tab': 'Ctrl+Shift+Tab',
      'next-tab': 'Ctrl+Tab',
      'split-right': 'Ctrl+Shift+5',
      'split-down': "Ctrl+Shift+'",
      'close-pane': '',
      'rename-pane': 'Ctrl+Shift+F2',
      'rename-tab': 'Ctrl+Shift+I',
      'copy-command': 'Ctrl+Shift+K',
      'copy-command-output': 'Ctrl+Shift+O',
      'rerun-command': 'Ctrl+Shift+R',
      'snippets-toggle': '',
      'history-toggle': '',
      'maximize-pane': '',
      'focus-next-pane': '',
      'focus-previous-pane': '',
      'move-pane-left': '',
      'move-pane-right': '',
      'move-pane-up': '',
      'move-pane-down': '',
      'save-document': '',
      'close-document': '',
    });
    expect(Object.keys(KEYBINDING_LABELS)).toEqual(Object.keys(DEFAULT_KEYBINDINGS));
    expect(defaultKeybindingsForPlatform('linux')).toEqual(defaultKeybindingsForPlatform('win32'));
  });

  it('uses Command for macOS application shortcuts', () => {
    expect(defaultKeybindingsForPlatform('darwin')).toMatchObject({
      'palette-toggle': 'Meta+Shift+P',
      'new-terminal': 'Meta+T',
      // Cmd+` is the macOS window switcher; VS Code uses Control+Shift+` on macOS too.
      'add-terminals': 'Ctrl+Shift+`',
      'close-tab': 'Meta+W',
      'settings-toggle': 'Meta+,',
      'font-reset': 'Meta+0',
      'split-down': 'Meta+Shift+\\',
      'rename-pane': 'Meta+Shift+F2',
      'next-tab': 'Ctrl+Tab',
      'previous-command': 'Meta+ArrowUp',
      'copy-command': 'Meta+Alt+C',
    });
  });

  it.each(PLATFORMS)('gives every %s default a unique chord with no known terminal, layout, or OS conflict', (platform) => {
    const defaults = Object.values(defaultKeybindingsForPlatform(platform)).filter(Boolean);
    expect(new Set(defaults).size).toBe(defaults.length);
    for (const shortcut of defaults) expect([shortcut, shortcutConflict(shortcut, platform)]).toEqual([shortcut, null]);
  });

  it.each(PLATFORMS)('never binds a %s default to a terminal copy, paste, or interrupt chord', (platform) => {
    for (const shortcut of Object.values(defaultKeybindingsForPlatform(platform)).filter(Boolean)) {
      const parsed = parseShortcut(shortcut);
      const event = keydown({
        key: parsed.key, code: /^[a-z]$/i.test(parsed.key) ? `Key${parsed.key.toUpperCase()}` : '',
        ctrlKey: parsed.ctrlKey, shiftKey: parsed.shiftKey, altKey: parsed.altKey, metaKey: parsed.metaKey,
      });
      expect([shortcut, isTerminalCopyChord(event, platform), isTerminalPasteChord(event, platform)])
        .toEqual([shortcut, false, false]);
      expect(shortcut.toLowerCase()).not.toBe('ctrl+c');
    }
  });
});

describe('matchesShortcut', () => {
  it('matches Shift+punctuation by its unshifted key, as keyboards report it', () => {
    // Shift turns \ into | and 5 into % on US-style layouts.
    expect(matchesShortcut(keydown({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+\\')).toBe(true);
    expect(matchesShortcut(keydown({ key: '|', code: 'Backslash', metaKey: true, shiftKey: true }), 'Meta+Shift+\\')).toBe(true);
    expect(matchesShortcut(keydown({ key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+5')).toBe(true);
    expect(matchesShortcut(keydown({ key: '"', code: 'Quote', ctrlKey: true, shiftKey: true }), "Ctrl+Shift+'")).toBe(true);
    expect(matchesShortcut(keydown({ key: '\\', code: 'Backslash', metaKey: true }), 'Meta+\\')).toBe(true);
    // Add terminals: Shift turns ` into ~ on US layouts; UK reports ¬ and German a dead key.
    expect(matchesShortcut(keydown({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+`')).toBe(true);
    expect(matchesShortcut(keydown({ key: '¬', code: 'Backquote', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+`')).toBe(true);
    expect(matchesShortcut(keydown({ key: 'Dead', code: 'Backquote', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+`')).toBe(true);
    expect(matchesShortcut(keydown({ key: '`', code: 'Backquote', ctrlKey: true }), 'Ctrl+Shift+`')).toBe(false);
  });

  it('keeps Shift significant so Ctrl+\\ and Ctrl+_ still reach the shell', () => {
    expect(matchesShortcut(keydown({ key: '\\', code: 'Backslash', ctrlKey: true }), 'Ctrl+Shift+\\')).toBe(false);
    expect(matchesShortcut(keydown({ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }), 'Ctrl+\\')).toBe(false);
    expect(matchesShortcut(keydown({ key: '_', code: 'Minus', ctrlKey: true, shiftKey: true }), 'Ctrl+-')).toBe(false);
    expect(matchesShortcut(keydown({ key: 'w', code: 'KeyW', ctrlKey: true }), 'Ctrl+Shift+W')).toBe(false);
    expect(matchesShortcut(keydown({ key: 'W', code: 'KeyW', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+W')).toBe(true);
  });

  it('matches Ctrl+Plus from the = key, Shift+=, the numpad, and layouts with their own + key', () => {
    expect(matchesShortcut(keydown({ key: '=', code: 'Equal', ctrlKey: true }), 'Ctrl+Plus')).toBe(true);
    expect(matchesShortcut(keydown({ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }), 'Ctrl+Plus')).toBe(true);
    expect(matchesShortcut(keydown({ key: '+', code: 'NumpadAdd', ctrlKey: true }), 'Ctrl+Plus')).toBe(true);
    expect(matchesShortcut(keydown({ key: '+', code: 'BracketRight', ctrlKey: true }), 'Ctrl+Plus')).toBe(true);
    expect(matchesShortcut(keydown({ key: '-', code: 'NumpadSubtract', ctrlKey: true }), 'Ctrl+-')).toBe(true);
  });

  it('matches letters from the physical key on non-Latin layouts and macOS Option', () => {
    // Cyrillic ЙЦУКЕН reports А for the F key.
    expect(matchesShortcut(keydown({ key: 'А', code: 'KeyF', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+F')).toBe(true);
    // macOS Option+C types ç.
    expect(matchesShortcut(keydown({ key: 'ç', code: 'KeyC', metaKey: true, altKey: true }), 'Meta+Alt+C')).toBe(true);
    // AZERTY reports à for the 0 key.
    expect(matchesShortcut(keydown({ key: 'à', code: 'Digit0', ctrlKey: true }), 'Ctrl+0')).toBe(true);
  });

  it('does not treat a character typed with AltGr as a Ctrl+Alt shortcut', () => {
    // Polish AltGr+C types ć; German AltGr+Q types @. Both report Ctrl and Alt on Windows.
    expect(matchesShortcut(keydown({ key: 'ć', code: 'KeyC', ctrlKey: true, altKey: true }), 'Ctrl+Alt+C')).toBe(false);
    expect(matchesShortcut(keydown({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }), 'Ctrl+Alt+Q')).toBe(false);
  });

  it('does not remap letters on Latin layouts such as Dvorak', () => {
    // Dvorak's physical F key types U; Ctrl+U must stay the shell's kill-line.
    expect(matchesShortcut(keydown({ key: 'u', code: 'KeyF', ctrlKey: true }), 'Ctrl+F')).toBe(false);
    expect(matchesShortcut(keydown({ key: 'u', code: 'KeyF', ctrlKey: true }), 'Ctrl+U')).toBe(true);
  });

  it('matches Space and named keys', () => {
    expect(matchesShortcut(keydown({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Space')).toBe(true);
    expect(matchesShortcut(keydown({ key: 'F2', code: 'F2', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+F2')).toBe(true);
    expect(matchesShortcut(keydown({ key: 'F2', code: 'F2' }), 'Ctrl+Shift+F2')).toBe(false);
    expect(matchesShortcut(keydown({ key: 'ArrowUp', code: 'ArrowUp', metaKey: true }), 'Meta+ArrowUp')).toBe(true);
  });
});

describe('formatShortcut', () => {
  it('records the key a shortcut is matched with, so a captured chord fires again', () => {
    const cases: Array<[KeyInit, string]> = [
      [{ key: '|', code: 'Backslash', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+\\'],
      [{ key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+5'],
      [{ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+Plus'],
      [{ key: '=', code: 'Equal', ctrlKey: true }, 'Ctrl+Plus'],
      [{ key: '+', code: 'NumpadAdd', ctrlKey: true }, 'Ctrl+Plus'],
      [{ key: 'А', code: 'KeyF', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+F'],
      [{ key: 'ç', code: 'KeyC', metaKey: true, altKey: true }, 'Alt+Meta+C'],
      [{ key: ' ', code: 'Space', ctrlKey: true }, 'Ctrl+Space'],
    ];
    for (const [init, expected] of cases) {
      const shortcut = formatShortcut(keydown(init));
      expect(shortcut).toBe(expected);
      expect(matchesShortcut(keydown(init), shortcut)).toBe(true);
    }
  });
});

describe('terminal clipboard chords', () => {
  const press = (init: KeyInit) => keydown({ code: `Key${(init.key ?? '').toUpperCase()}`, ...init });

  it('pastes with Ctrl+V only on Windows and never treats macOS Control+V as paste', () => {
    expect(isTerminalPasteChord(press({ key: 'v', ctrlKey: true }), 'win32')).toBe(true);
    expect(isTerminalPasteChord(press({ key: 'v', ctrlKey: true }), 'linux')).toBe(false);
    expect(isTerminalPasteChord(press({ key: 'v', ctrlKey: true }), 'darwin')).toBe(false);
    for (const platform of PLATFORMS) {
      expect(isTerminalPasteChord(press({ key: 'V', ctrlKey: true, shiftKey: true }), platform)).toBe(true);
      expect(isTerminalPasteChord(keydown({ key: 'Insert', code: 'Insert', shiftKey: true }), platform)).toBe(true);
      expect(isTerminalPasteChord(press({ key: 'v', ctrlKey: true, altKey: true }), platform)).toBe(false);
    }
    expect(isTerminalPasteChord(press({ key: 'v', metaKey: true }), 'darwin')).toBe(true);
  });

  it('copies with Ctrl+C only off macOS, where Control+C always interrupts', () => {
    expect(isTerminalCopyChord(press({ key: 'c', ctrlKey: true }), 'win32')).toBe(true);
    expect(isTerminalCopyChord(press({ key: 'c', ctrlKey: true }), 'linux')).toBe(true);
    expect(isTerminalCopyChord(press({ key: 'c', ctrlKey: true }), 'darwin')).toBe(false);
    expect(isTerminalCopyChord(press({ key: 'c', metaKey: true }), 'darwin')).toBe(true);
    for (const platform of PLATFORMS) {
      expect(isTerminalCopyChord(press({ key: 'C', ctrlKey: true, shiftKey: true }), platform)).toBe(true);
    }
    // Cyrillic С on the C key still copies.
    expect(isTerminalCopyChord(keydown({ key: 'с', code: 'KeyC', ctrlKey: true }), 'linux')).toBe(true);
  });
});

describe('shortcutConflict', () => {
  it('warns about keys shells, terminal programs, layouts, and the OS need', () => {
    expect(shortcutConflict('Ctrl+W', 'win32')).toMatch(/delete the previous word/);
    expect(shortcutConflict('Ctrl+B', 'linux')).toMatch(/tmux prefix/);
    expect(shortcutConflict('Ctrl+\\', 'linux')).toMatch(/control character/);
    expect(shortcutConflict('Ctrl+Alt+C', 'win32')).toMatch(/AltGr/);
    expect(shortcutConflict('Alt+B', 'linux')).toMatch(/Meta/);
    expect(shortcutConflict('F2', 'win32')).toMatch(/htop/);
    expect(shortcutConflict('Ctrl+Shift+-', 'linux')).toMatch(/undo/);
    expect(shortcutConflict('Ctrl+C', 'linux')).toMatch(/copies/);
    expect(shortcutConflict('Meta+E', 'win32')).toMatch(/Windows key/);
    expect(shortcutConflict('Ctrl+V', 'darwin')).toMatch(/terminal key/);
    expect(shortcutConflict('Meta+Q', 'darwin')).toMatch(/reserved by macOS/);
    expect(shortcutConflict('Alt+F', 'darwin')).toMatch(/Option|special characters/);
  });

  it('accepts ordinary application chords', () => {
    expect(shortcutConflict('Ctrl+Shift+J', 'win32')).toBeNull();
    expect(shortcutConflict('Meta+J', 'darwin')).toBeNull();
    expect(shortcutConflict('', 'linux')).toBeNull();
  });
});

describe('keybinding migration', () => {
  // Schema 1 had no add-terminals action.
  const OLD_WINDOWS: Record<Exclude<KeybindingAction, 'add-terminals'>, string> = {
    'search-toggle': 'Ctrl+F', 'palette-toggle': 'Ctrl+Shift+P', 'new-terminal': 'Ctrl+Shift+T', 'close-tab': 'Ctrl+W',
    'settings-toggle': 'Ctrl+,', 'toggle-sidebar': 'Ctrl+B', 'font-increase': 'Ctrl+Plus', 'font-decrease': 'Ctrl+-',
    'font-reset': 'Ctrl+0', 'previous-tab': 'Ctrl+Shift+Tab', 'next-tab': 'Ctrl+Tab', 'snippets-toggle': '',
    'history-toggle': '', 'split-right': 'Ctrl+\\', 'split-down': 'Ctrl+Shift+\\', 'close-pane': 'Ctrl+Shift+W',
    'maximize-pane': '', 'focus-next-pane': '', 'focus-previous-pane': '', 'move-pane-left': '', 'move-pane-right': '',
    'move-pane-up': '', 'move-pane-down': '', 'rename-pane': 'F2', 'rename-tab': 'Ctrl+F2', 'save-document': '',
    'close-document': '', 'previous-command': 'Ctrl+Shift+ArrowUp', 'next-command': 'Ctrl+Shift+ArrowDown',
    'copy-command': 'Ctrl+Alt+C', 'copy-command-output': 'Ctrl+Alt+O', 'rerun-command': 'Ctrl+Alt+R',
  };
  const OLD_MAC: Record<Exclude<KeybindingAction, 'add-terminals'>, string> = {
    ...OLD_WINDOWS,
    'search-toggle': 'Meta+F', 'palette-toggle': 'Meta+Shift+P', 'new-terminal': 'Meta+T', 'close-tab': 'Meta+W',
    'settings-toggle': 'Meta+,', 'toggle-sidebar': 'Meta+B', 'font-increase': 'Meta+Plus', 'font-decrease': 'Meta+-',
    'font-reset': 'Meta+0', 'split-right': 'Meta+\\', 'split-down': 'Meta+Shift+\\', 'close-pane': 'Meta+Shift+W',
    'rename-tab': 'Meta+F2',
  };

  it.each([['win32', OLD_WINDOWS], ['linux', OLD_WINDOWS], ['darwin', OLD_MAC]] as const)(
    'moves every untouched %s default to the new default',
    (platform, old) => {
      expect(migrateKeybindings(old, platform)).toEqual(defaultKeybindingsForPlatform(platform));
    },
  );

  it('keeps customized bindings and moves only the old defaults around them', () => {
    const migrated = migrateKeybindings({ ...OLD_WINDOWS, 'close-tab': 'Alt+X', 'history-toggle': 'Ctrl+Shift+H' }, 'win32');
    expect(migrated).toEqual({
      ...defaultKeybindingsForPlatform('win32'),
      'close-tab': 'Alt+X',
      'history-toggle': 'Ctrl+Shift+H',
    });
  });

  it('keeps an explicitly unassigned action unassigned', () => {
    expect(migrateKeybindings({ ...OLD_WINDOWS, 'search-toggle': '' }, 'linux')['search-toggle']).toBe('');
  });

  it('leaves a moved action unassigned rather than duplicating a customized chord', () => {
    const migrated = migrateKeybindings({ ...OLD_WINDOWS, 'history-toggle': 'Ctrl+Shift+F' }, 'win32');
    expect(migrated['history-toggle']).toBe('Ctrl+Shift+F');
    expect(migrated['search-toggle']).toBe('');
  });

  it('moves a Mac map saved before macOS had Command defaults', () => {
    expect(migrateKeybindings({ ...OLD_WINDOWS }, 'darwin')).toEqual(defaultKeybindingsForPlatform('darwin'));
  });

  it('does not touch a map already written against the current defaults', () => {
    const current = { ...defaultKeybindingsForPlatform('win32'), 'close-tab': 'Ctrl+W' };
    expect(migrateKeybindings({ ...current, [KEYBINDINGS_SCHEMA_KEY]: KEYBINDINGS_SCHEMA_VERSION }, 'win32'))
      .toEqual(current);
  });

  it('keeps unknown actions', () => {
    expect(migrateKeybindings({ ...OLD_WINDOWS, custom: 'Alt+J' }, 'win32')).toMatchObject({ custom: 'Alt+J' });
  });

  it.each(PLATFORMS)('gives a %s schema 2 map only the new add-terminals default and keeps every stored value', (platform) => {
    const { 'add-terminals': _added, ...schema2 } = defaultKeybindingsForPlatform(platform);
    // A deliberate schema-2 choice of an old schema-1 default (F2) is not moved again.
    const stored = { ...schema2, 'rename-pane': 'F2', [KEYBINDINGS_SCHEMA_KEY]: '2' };
    expect(migrateKeybindings(stored, platform)).toEqual({
      ...defaultKeybindingsForPlatform(platform), 'rename-pane': 'F2',
    });
  });

  it('keeps "New project" on the stored new-terminal key and its customization', () => {
    const { 'add-terminals': _added, ...schema2 } = defaultKeybindingsForPlatform('win32');
    expect(migrateKeybindings({ ...schema2, 'new-terminal': 'Ctrl+Shift+N', [KEYBINDINGS_SCHEMA_KEY]: '2' }, 'win32'))
      .toMatchObject({ 'new-terminal': 'Ctrl+Shift+N', 'add-terminals': 'Ctrl+Shift+`' });
  });

  it('leaves add-terminals unassigned when a schema 2 customization already uses its chord', () => {
    const { 'add-terminals': _added, ...schema2 } = defaultKeybindingsForPlatform('linux');
    const migrated = migrateKeybindings({ ...schema2, 'history-toggle': 'Ctrl+Shift+`', [KEYBINDINGS_SCHEMA_KEY]: '2' }, 'linux');
    expect(migrated['history-toggle']).toBe('Ctrl+Shift+`');
    expect(migrated['add-terminals']).toBe('');
  });
});

describe('shortcutKeycaps', () => {
  it('uses modifier glyphs on macOS and names elsewhere', async () => {
    const { shortcutKeycaps } = await import('../../src/renderer/keybindings');
    expect(shortcutKeycaps('Meta+Shift+P', 'darwin')).toEqual(['⌘', '⇧', 'P']);
    expect(shortcutKeycaps('Ctrl+Alt+C', 'darwin')).toEqual(['⌃', '⌥', 'C']);
    expect(shortcutKeycaps('Ctrl+Shift+P', 'win32')).toEqual(['Ctrl', 'Shift', 'P']);
    expect(shortcutKeycaps('Ctrl+Plus', 'linux')).toEqual(['Ctrl', '+']);
    expect(shortcutKeycaps('Ctrl+Shift+ArrowUp', 'win32')).toEqual(['Ctrl', 'Shift', '↑']);
    expect(shortcutKeycaps('', 'darwin')).toEqual([]);
  });
});
