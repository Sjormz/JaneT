import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import { themeScheme, type ThemeDefinition } from './themes';

export type MonacoModule = typeof import('monaco-editor');

let monacoPromise: Promise<MonacoModule> | null = null;

function installWorkerFactory(): void {
  globalThis.MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === 'json') return new JsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
      if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
      return new EditorWorker();
    },
  };
}

export function loadMonaco(): Promise<MonacoModule> {
  if (!monacoPromise) {
    installWorkerFactory();
    monacoPromise = import('monaco-editor').catch((error) => {
      monacoPromise = null;
      throw error;
    });
  }
  return monacoPromise;
}

export function defineJaneTMonacoTheme(monaco: MonacoModule, theme: ThemeDefinition): string {
  const name = `janet-${theme.name}`;
  const light = themeScheme(theme.css) === 'light';
  const color = (key: string, fallback: string) => theme.css[key]?.replace('#', '') ?? fallback;
  const hex = (key: string, fallback: string) => `#${color(key, fallback)}`;
  // Syntax colours come from the theme palette, so code in the editor matches the terminal and the chrome.
  const syntax = (token: string, key: string, fallback: string, fontStyle?: string) =>
    ({ token, foreground: color(key, fallback), ...(fontStyle ? { fontStyle } : {}) });
  monaco.editor.defineTheme(name, {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      syntax('comment', 'text-muted', '565f89', 'italic'),
      syntax('keyword', 'magenta', 'bb9af7'),
      syntax('string', 'green', '9ece6a'),
      syntax('number', 'yellow', 'e0af68'),
      syntax('regexp', 'cyan', '7dcfff'),
      syntax('type', 'cyan', '7dcfff'),
      syntax('function', 'blue', '7aa2f7'),
      syntax('tag', 'red', 'f7768e'),
      syntax('attribute.name', 'yellow', 'e0af68'),
      syntax('delimiter', 'text-secondary', 'a9b1d6'),
    ],
    colors: {
      'editor.background': hex('bg-primary', light ? 'fdf6e3' : '0f0f1a'),
      'editor.foreground': hex('text-primary', light ? '2f4850' : 'c0caf5'),
      'editorCursor.foreground': hex('text-accent', '7aa2f7'),
      'editor.selectionBackground': hex('bg-active', '33467c'),
      'editor.inactiveSelectionBackground': hex('bg-tertiary', '24253b'),
      'editor.lineHighlightBackground': hex('bg-secondary', '1a1b2e'),
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': hex('text-muted', '565f89'),
      'editorLineNumber.activeForeground': hex('text-secondary', 'a9b1d6'),
      'editorGutter.background': hex('bg-primary', light ? 'fdf6e3' : '0f0f1a'),
      'editorIndentGuide.background1': hex('border-color', '2a2b42'),
      'editorBracketMatch.border': hex('border-active', '7aa2f7'),
      'editorWidget.background': hex('bg-secondary', '1a1b2e'),
      'editorWidget.border': hex('border-color', '2a2b42'),
      'scrollbarSlider.background': `${hex('text-muted', '565f89')}40`,
      'scrollbarSlider.hoverBackground': `${hex('text-muted', '565f89')}70`,
      'diffEditor.insertedTextBackground': `${hex('green', '9ece6a')}26`,
      'diffEditor.removedTextBackground': `${hex('red', 'f7768e')}26`,
      'focusBorder': hex('border-active', '7aa2f7'),
    },
  });
  return name;
}
