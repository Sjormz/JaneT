import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_LABELS,
  defaultKeybindingsForPlatform,
} from '../../src/renderer/keybindings';

describe('keyboard shortcut defaults', () => {
  it('uses conventional defaults only for frequent actions', () => {
    expect(DEFAULT_KEYBINDINGS).toMatchObject({
      'palette-toggle': 'Ctrl+Shift+P',
      'new-terminal': 'Ctrl+Shift+T',
      'close-tab': 'Ctrl+W',
      'settings-toggle': 'Ctrl+,',
      'font-reset': 'Ctrl+0',
      'previous-tab': 'Ctrl+Shift+Tab',
      'next-tab': 'Ctrl+Tab',
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
    expect(new Set(Object.values(DEFAULT_KEYBINDINGS).filter(Boolean)).size)
      .toBe(Object.values(DEFAULT_KEYBINDINGS).filter(Boolean).length);
    expect(Object.keys(KEYBINDING_LABELS)).toEqual(Object.keys(DEFAULT_KEYBINDINGS));
  });

  it('uses Command for macOS application shortcuts without changing terminal navigation chords', () => {
    expect(defaultKeybindingsForPlatform('darwin')).toMatchObject({
      'palette-toggle': 'Meta+Shift+P',
      'new-terminal': 'Meta+T',
      'close-tab': 'Meta+W',
      'settings-toggle': 'Meta+,',
      'font-reset': 'Meta+0',
      'next-tab': 'Ctrl+Tab',
      'previous-command': 'Ctrl+Shift+ArrowUp',
    });
  });
});
