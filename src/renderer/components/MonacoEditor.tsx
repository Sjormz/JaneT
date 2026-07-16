import React, { useEffect, useRef, useState } from 'react';
import type { editor as MonacoEditorNamespace } from 'monaco-editor';
import type { EditorDocument } from '../editorDocuments';
import { editorDocumentModelUri, editorLanguageForPath } from '../editorDocuments';
import { getTheme, type ThemeName } from '../themes';
import {
  defineJaneTMonacoTheme,
  loadMonaco,
  type MonacoModule,
} from '../monacoRuntime';

interface CachedModel {
  model: MonacoEditorNamespace.ITextModel;
  viewState: MonacoEditorNamespace.ICodeEditorViewState | null;
}

const cachedModels = new Map<string, CachedModel>();

export function disposeEditorDocumentModel(key: string): void {
  const cached = cachedModels.get(key);
  if (!cached) return;
  cached.model.dispose();
  cachedModels.delete(key);
}

export function disposeAllEditorDocumentModels(): void {
  for (const cached of cachedModels.values()) cached.model.dispose();
  cachedModels.clear();
}

interface MonacoEditorProps {
  document: EditorDocument;
  themeName: ThemeName;
  fontSize: number;
  fontFamily: string;
  onChange: (content: string) => void;
  onSave: () => void;
}

export default function MonacoEditor({
  document,
  themeName,
  fontSize,
  fontFamily,
  onChange,
  onSave,
}: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const activeKeyRef = useRef(document.key);
  const documentRef = useRef(document);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const appearanceRef = useRef({ themeName, fontSize, fontFamily });
  const suppressChangeRef = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  documentRef.current = document;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  appearanceRef.current = { themeName, fontSize, fontFamily };

  useEffect(() => {
    let disposed = false;
    let contentSubscription: { dispose(): void } | null = null;

    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      const currentDocument = documentRef.current;
      const appearance = appearanceRef.current;
      monacoRef.current = monaco;
      const theme = defineJaneTMonacoTheme(monaco, getTheme(appearance.themeName));
      const instance = monaco.editor.create(containerRef.current, {
        model: null,
        theme,
        automaticLayout: true,
        accessibilitySupport: 'auto',
        ariaLabel: `Editing ${currentDocument.title}`,
        fontSize: appearance.fontSize,
        fontFamily: appearance.fontFamily,
        fontLigatures: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
      });
      editorRef.current = instance;
      contentSubscription = instance.onDidChangeModelContent(() => {
        if (suppressChangeRef.current) return;
        onChangeRef.current(instance.getValue());
      });
      instance.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => onSaveRef.current(),
      );
      activeKeyRef.current = currentDocument.key;
      attachDocumentModel(monaco, instance, currentDocument, suppressChangeRef);
    }).catch((error) => {
      console.error('[editor] failed to load Monaco:', error);
      if (!disposed) {
        setLoadError(error instanceof Error ? error.message : 'The editor could not be loaded.');
      }
    });

    return () => {
      disposed = true;
      const instance = editorRef.current;
      if (instance) {
        const key = activeKeyRef.current;
        const cached = cachedModels.get(key);
        if (cached) cached.viewState = instance.saveViewState();
        contentSubscription?.dispose();
        instance.dispose();
      }
      editorRef.current = null;
      monacoRef.current = null;
    };
    // Monaco owns the editor instance for this mounted surface. Document,
    // appearance, and callback changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const instance = editorRef.current;
    if (!monaco || !instance) return;
    const previous = cachedModels.get(activeKeyRef.current);
    if (previous) previous.viewState = instance.saveViewState();
    activeKeyRef.current = document.key;
    attachDocumentModel(monaco, instance, document, suppressChangeRef);
    instance.updateOptions({ ariaLabel: `Editing ${document.title}` });
  }, [document.key, document.resolvedPath, document.title]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;
    const currentValue = instance.getValue();
    if (currentValue === document.content) return;
    suppressChangeRef.current = true;
    try {
      instance.setValue(document.content);
    } finally {
      suppressChangeRef.current = false;
    }
  }, [document.content]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const instance = editorRef.current;
    if (!monaco || !instance) return;
    const theme = defineJaneTMonacoTheme(monaco, getTheme(themeName));
    monaco.editor.setTheme(theme);
    instance.updateOptions({ fontSize, fontFamily });
  }, [fontFamily, fontSize, themeName]);

  if (loadError) {
    return (
      <div className="editor-state error" role="alert">
        <strong>Couldn’t load the editor</strong>
        <span>{loadError}</span>
        <button
          type="button"
          onClick={() => {
            setLoadError(null);
            setLoadAttempt((attempt) => attempt + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return <div ref={containerRef} className="monaco-editor-host" data-editor-document={document.key} />;
}

function attachDocumentModel(
  monaco: MonacoModule,
  editor: MonacoEditorNamespace.IStandaloneCodeEditor,
  document: EditorDocument,
  suppressChangeRef: React.MutableRefObject<boolean>,
): void {
  let cached = cachedModels.get(document.key);
  const language = editorLanguageForPath(document.resolvedPath || document.requestedPath);
  if (!cached) {
    const uri = monaco.Uri.parse(editorDocumentModelUri(document));
    cached = {
      model: monaco.editor.createModel(document.content, language, uri),
      viewState: null,
    };
    cachedModels.set(document.key, cached);
  } else {
    monaco.editor.setModelLanguage(cached.model, language);
    if (cached.model.getValue() !== document.content) {
      suppressChangeRef.current = true;
      try {
        cached.model.setValue(document.content);
      } finally {
        suppressChangeRef.current = false;
      }
    }
  }
  editor.setModel(cached.model);
  if (cached.viewState) editor.restoreViewState(cached.viewState);
}
