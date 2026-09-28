import { describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor/editor/editor.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/languages/features/json/json.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/languages/features/css/css.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/languages/features/html/html.worker?worker', () => ({ default: class {} }));
vi.mock('monaco-editor/languages/features/typescript/ts.worker?worker', () => ({ default: class {} }));

import { defineJaneTMonacoTheme, type MonacoModule } from '../../src/renderer/monacoRuntime';
import { getTheme, themeNames, themeScheme } from '../../src/renderer/themes';

describe('Monaco theme', () => {
  it('follows each theme scheme and palette', () => {
    for (const name of themeNames) {
      const defineTheme = vi.fn();
      const theme = getTheme(name);
      expect(defineJaneTMonacoTheme({ editor: { defineTheme } } as unknown as MonacoModule, theme)).toBe(`janet-${name}`);
      const [, definition] = defineTheme.mock.calls[0];
      expect(definition.base, name).toBe(themeScheme(theme.css) === 'light' ? 'vs' : 'vs-dark');
      expect(definition.colors['editor.background']).toBe(theme.css['bg-primary']);
      expect(definition.colors['editor.foreground']).toBe(theme.css['text-primary']);
      const rule = (token: string) => definition.rules.find((entry: { token: string }) => entry.token === token)?.foreground;
      expect(`#${rule('keyword')}`).toBe(theme.css.magenta);
      expect(`#${rule('string')}`).toBe(theme.css.green);
      expect(`#${rule('comment')}`).toBe(theme.css['text-muted']);
    }
  });
});
