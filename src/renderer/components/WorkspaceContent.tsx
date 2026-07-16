import React, { useMemo } from 'react';
import type { EditorDocument } from '../editorDocuments';
import { isEditorDocumentDirty } from '../editorDocuments';
import type { ThemeName } from '../themes';
import {
  AlertIcon,
  FileTextIcon,
  SaveIcon,
  SpinnerIcon,
  TerminalTabIcon,
  XCloseIcon,
} from '../icons';
import MonacoEditor from './MonacoEditor';
import Tooltip from './Tooltip';

interface WorkspaceContentProps {
  tabId: string;
  terminal: React.ReactNode;
  documents: EditorDocument[];
  activeSurface: 'terminal' | string;
  themeName: ThemeName;
  fontSize: number;
  fontFamily: string;
  onSelectSurface: (surface: 'terminal' | string) => void;
  onDocumentChange: (key: string, content: string) => void;
  onSaveDocument: (key: string) => void;
  onRetryDocument: (key: string) => void;
  onCloseDocument: (key: string, fallbackFocus: () => HTMLElement | null) => void;
}

export default function WorkspaceContent({
  tabId,
  terminal,
  documents,
  activeSurface,
  themeName,
  fontSize,
  fontFamily,
  onSelectSurface,
  onDocumentChange,
  onSaveDocument,
  onRetryDocument,
  onCloseDocument,
}: WorkspaceContentProps) {
  const activeDocument = useMemo(
    () => documents.find((document) => document.key === activeSurface) ?? null,
    [activeSurface, documents],
  );
  const effectiveSurface = activeDocument ? activeDocument.key : 'terminal';
  const tabIds = ['terminal', ...documents.map((document) => document.key)];

  const moveTabFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabIds.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabIds.length) % tabIds.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabIds.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabIds[nextIndex];
    onSelectSurface(next);
    document.getElementById(surfaceTabId(tabId, nextIndex))?.focus();
  };

  if (documents.length === 0) return <>{terminal}</>;

  return (
    <div className="workspace-content">
      <div className="document-tabbar">
        <div className="document-tabs" role="tablist" aria-label="Terminal and open files">
          <button
            id={surfaceTabId(tabId, 0)}
            type="button"
            role="tab"
            className={`document-tab terminal${effectiveSurface === 'terminal' ? ' active' : ''}`}
            aria-selected={effectiveSurface === 'terminal'}
            aria-controls={`workspace-surface-${tabId}`}
            tabIndex={effectiveSurface === 'terminal' ? 0 : -1}
            onClick={() => onSelectSurface('terminal')}
            onKeyDown={(event) => moveTabFocus(event, 0)}
          >
            <TerminalTabIcon size="sm" />
            <span>Terminal</span>
          </button>
          {documents.map((document, index) => {
            const active = effectiveSurface === document.key;
            const dirty = isEditorDocumentDirty(document);
            return (
              <div key={document.key} className={`document-tab-shell${active ? ' active' : ''}`}>
                <button
                  id={surfaceTabId(tabId, index + 1)}
                  type="button"
                  role="tab"
                  className={`document-tab file${active ? ' active' : ''}`}
                  aria-selected={active}
                  aria-controls={`workspace-surface-${tabId}`}
                  aria-label={`${document.title}${dirty ? ', unsaved changes' : ''}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSelectSurface(document.key)}
                  onKeyDown={(event) => moveTabFocus(event, index + 1)}
                >
                  <FileTextIcon size="sm" />
                  <span className="document-tab-title">{document.title}</span>
                  {dirty && <span className="document-dirty-marker" aria-hidden="true">●</span>}
                </button>
                <Tooltip label={`Close ${document.title}`} placement="bottom">
                  <button
                    type="button"
                    className="document-tab-close"
                    aria-label={`Close ${document.title}`}
                    onClick={() => onCloseDocument(
                      document.key,
                      () => globalThis.document.getElementById(surfaceTabId(tabId, index)) as HTMLElement | null,
                    )}
                  >
                    <XCloseIcon size="xs" />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
        {activeDocument?.loadState === 'ready' && (
          <Tooltip label={activeDocument.saveState === 'saving' ? 'Saving file' : 'Save file'} placement="bottom">
            <button
              type="button"
              className="document-save-button"
              aria-label={activeDocument.saveState === 'saving' ? `Saving ${activeDocument.title}` : `Save ${activeDocument.title}`}
              disabled={activeDocument.saveState === 'saving' || !isEditorDocumentDirty(activeDocument)}
              onClick={() => onSaveDocument(activeDocument.key)}
            >
              {activeDocument.saveState === 'saving' ? <SpinnerIcon size="sm" /> : <SaveIcon size="sm" />}
            </button>
          </Tooltip>
        )}
      </div>

      <div
        id={`workspace-surface-${tabId}`}
        className="workspace-content-surface"
        role="tabpanel"
        aria-labelledby={surfaceTabId(tabId, Math.max(0, tabIds.indexOf(effectiveSurface)))}
        aria-live={activeDocument?.loadState === 'loading' ? 'polite' : undefined}
      >
        {effectiveSurface === 'terminal' ? terminal : activeDocument && (
          activeDocument.loadState === 'loading' ? (
            <div className="editor-state" role="status">
              <SpinnerIcon size="lg" />
              <span>Opening {activeDocument.title}…</span>
            </div>
          ) : activeDocument.loadState === 'error' ? (
            <div className="editor-state error" role="alert">
              <AlertIcon size="lg" />
              <strong>Couldn’t open {activeDocument.title}</strong>
              <span>{activeDocument.error?.message ?? 'The file could not be opened.'}</span>
              <button type="button" onClick={() => onRetryDocument(activeDocument.key)}>Try again</button>
            </div>
          ) : (
            <MonacoEditor
              document={activeDocument}
              themeName={themeName}
              fontSize={fontSize}
              fontFamily={fontFamily}
              onChange={(content) => onDocumentChange(activeDocument.key, content)}
              onSave={() => onSaveDocument(activeDocument.key)}
            />
          )
        )}
      </div>
      {activeDocument?.saveState === 'error' && activeDocument.error && (
        <div className="editor-save-error" role="alert">{activeDocument.error.message}</div>
      )}
    </div>
  );
}

function surfaceTabId(tabId: string, index: number): string {
  return `workspace-surface-tab-${tabId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${index}`;
}
