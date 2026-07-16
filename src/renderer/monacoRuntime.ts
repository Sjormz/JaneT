import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import type { ThemeDefinition } from './themes';

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
  const light = theme.name === 'solarized-light';
  const color = (key: string, fallback: string) => theme.css[key]?.replace('#', '') ?? fallback;
  monaco.editor.defineTheme(name, {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': `#${color('bg-primary', light ? 'fdf6e3' : '0f0f1a')}`,
      'editor.foreground': `#${color('text-primary', light ? '2f4850' : 'c0caf5')}`,
      'editorCursor.foreground': `#${color('text-accent', '7aa2f7')}`,
      'editor.selectionBackground': `#${color('bg-active', '33467c')}`,
      'editor.inactiveSelectionBackground': `#${color('bg-tertiary', '24253b')}`,
      'editorLineNumber.foreground': `#${color('text-muted', '565f89')}`,
      'editorLineNumber.activeForeground': `#${color('text-secondary', 'a9b1d6')}`,
      'editorWidget.background': `#${color('bg-secondary', '1a1b2e')}`,
      'editorWidget.border': `#${color('border-color', '2a2b42')}`,
      'focusBorder': `#${color('border-active', '7aa2f7')}`,
    },
  });
  return name;
}
