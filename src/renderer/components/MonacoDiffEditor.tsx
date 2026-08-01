import React, { useEffect, useRef, useState } from 'react';
import type { editor as MonacoEditorNamespace } from 'monaco-editor';
import type { EditorDocument } from '../editorDocuments';
import { editorDocumentModelUri, editorLanguageForPath } from '../editorDocuments';
import { defineJaneTMonacoTheme, loadMonaco } from '../monacoRuntime';
import { getTheme, type ThemeName } from '../themes';

interface MonacoDiffEditorProps {
  document: EditorDocument;
  themeName: ThemeName;
  fontSize: number;
  fontFamily: string;
}

export default function MonacoDiffEditor({
  document,
  themeName,
  fontSize,
  fontFamily,
}: MonacoDiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditorNamespace.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Awaited<ReturnType<typeof loadMonaco>> | null>(null);
  const appearanceRef = useRef({ themeName, fontSize, fontFamily });
  const [loadError, setLoadError] = useState<string | null>(null);
  appearanceRef.current = { themeName, fontSize, fontFamily };

  useEffect(() => {
    let disposed = false;
    let instance: MonacoEditorNamespace.IStandaloneDiffEditor | null = null;
    let original: MonacoEditorNamespace.ITextModel | null = null;
    let modified: MonacoEditorNamespace.ITextModel | null = null;

    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      const appearance = appearanceRef.current;
      const language = editorLanguageForPath(document.resource.path);
      const baseUri = editorDocumentModelUri(document);
      original = monaco.editor.createModel(
        document.originalContent ?? '',
        language,
        monaco.Uri.parse(`${baseUri}&version=original`),
      );
      modified = monaco.editor.createModel(
        document.content,
        language,
        monaco.Uri.parse(`${baseUri}&version=modified`),
      );
      instance = monaco.editor.createDiffEditor(containerRef.current, {
        accessibilitySupport: 'auto',
        automaticLayout: true,
        fontFamily: appearance.fontFamily,
        fontSize: appearance.fontSize,
        minimap: { enabled: false },
        modifiedAriaLabel: `Working version of ${document.title}`,
        originalAriaLabel: `Original version of ${document.title}`,
        originalEditable: false,
        readOnly: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        theme: defineJaneTMonacoTheme(monaco, getTheme(appearance.themeName)),
      });
      instance.setModel({ original, modified });
      editorRef.current = instance;
      monacoRef.current = monaco;
    }).catch((error) => {
      if (!disposed) setLoadError(error instanceof Error ? error.message : 'The diff editor could not be loaded.');
    });

    return () => {
      disposed = true;
      instance?.dispose();
      original?.dispose();
      modified?.dispose();
      if (editorRef.current === instance) editorRef.current = null;
      monacoRef.current = null;
    };
  }, [document]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const instance = editorRef.current;
    if (!monaco || !instance) return;
    monaco.editor.setTheme(defineJaneTMonacoTheme(monaco, getTheme(themeName)));
    instance.updateOptions({ fontFamily, fontSize });
  }, [fontFamily, fontSize, themeName]);

  if (loadError) return <div className="editor-state error" role="alert">{loadError}</div>;
  return <div ref={containerRef} className="monaco-editor-host" data-editor-document={document.key} />;
}
