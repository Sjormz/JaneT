import { describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import WorkspaceContent from '../../src/renderer/components/WorkspaceContent';
import type { EditorDocument } from '../../src/renderer/editorDocuments';

vi.mock('../../src/renderer/components/MonacoEditor', () => ({
  default: ({
    document,
    onChange,
    onSave,
  }: {
    document: EditorDocument;
    onChange: (content: string) => void;
    onSave: () => void;
  }) => (
    <div data-testid="monaco-editor" data-document-key={document.key}>
      <button type="button" onClick={() => onChange('edited in Monaco')}>Change editor content</button>
      <button type="button" onClick={onSave}>Save from editor</button>
    </div>
  ),
}));

const revision = {
  token: 'a'.repeat(64),
  size: 12,
  mtime: '2026-07-16T12:00:00.000Z',
};

function documentFixture(
  key: string,
  title: string,
  overrides: Partial<EditorDocument> = {},
): EditorDocument {
  const path = `/workspace/${title}`;
  return {
    key,
    ownerTabId: 'tab/with spaces',
    resource: { kind: 'local', path },
    title,
    requestedPath: path,
    resolvedPath: path,
    content: 'saved content',
    savedContent: 'saved content',
    hasUtf8Bom: false,
    revision,
    loadState: 'ready',
    saveState: 'idle',
    error: null,
    ...overrides,
  };
}

const defaultDocuments = [
  documentFixture('document:first', 'first.ts'),
  documentFixture('document:second', 'second.md'),
];

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof WorkspaceContent>> = {}) {
  const props: React.ComponentProps<typeof WorkspaceContent> = {
    tabId: 'tab/with spaces',
    terminal: <div data-testid="terminal-surface">Terminal surface</div>,
    documents: defaultDocuments,
    activeSurface: 'terminal',
    themeName: 'tokyo-night',
    fontSize: 14,
    fontFamily: 'JetBrains Mono',
    onSelectSurface: vi.fn(),
    onDocumentChange: vi.fn(),
    onSaveDocument: vi.fn(),
    onRetryDocument: vi.fn(),
    onCloseDocument: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceContent {...props} />), props };
}

describe('WorkspaceContent tabs', () => {
  it('renders only the terminal surface when no documents are open', () => {
    renderWorkspace({ documents: [], activeSurface: 'terminal' });

    expect(screen.getByTestId('terminal-surface')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('uses roving keyboard navigation across terminal and document tabs', () => {
    const onSelectSurface = vi.fn();

    function Harness() {
      const [surface, setSurface] = useState<'terminal' | string>('terminal');
      return (
        <WorkspaceContent
          tabId="tab/with spaces"
          terminal={<div data-testid="terminal-surface">Terminal surface</div>}
          documents={defaultDocuments}
          activeSurface={surface}
          themeName="tokyo-night"
          fontSize={14}
          fontFamily="JetBrains Mono"
          onSelectSurface={(next) => {
            onSelectSurface(next);
            setSurface(next);
          }}
          onDocumentChange={vi.fn()}
          onSaveDocument={vi.fn()}
          onRetryDocument={vi.fn()}
          onCloseDocument={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const terminalTab = screen.getByRole('tab', { name: 'Terminal' });
    const firstTab = screen.getByRole('tab', { name: 'first.ts' });
    const secondTab = screen.getByRole('tab', { name: 'second.md' });

    terminalTab.focus();
    fireEvent.keyDown(terminalTab, { key: 'ArrowRight' });
    expect(onSelectSurface).toHaveBeenLastCalledWith('document:first');
    expect(firstTab).toHaveFocus();
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
    expect(terminalTab).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(firstTab, { key: 'End' });
    expect(onSelectSurface).toHaveBeenLastCalledWith('document:second');
    expect(secondTab).toHaveFocus();

    fireEvent.keyDown(secondTab, { key: 'ArrowRight' });
    expect(onSelectSurface).toHaveBeenLastCalledWith('terminal');
    expect(terminalTab).toHaveFocus();

    fireEvent.keyDown(terminalTab, { key: 'ArrowLeft' });
    expect(onSelectSurface).toHaveBeenLastCalledWith('document:second');
    expect(secondTab).toHaveFocus();

    fireEvent.keyDown(secondTab, { key: 'Home' });
    expect(onSelectSurface).toHaveBeenLastCalledWith('terminal');
    expect(terminalTab).toHaveFocus();
  });

  it('announces unsaved documents and enables save only for dirty content', () => {
    const dirty = documentFixture('document:first', 'first.ts', {
      content: 'unsaved content',
    });
    renderWorkspace({ documents: [dirty], activeSurface: dirty.key });

    expect(screen.getByRole('tab', { name: 'first.ts, unsaved changes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(document.querySelector('.document-dirty-marker')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Save first.ts' })).toBeEnabled();
  });

  it('falls back to the terminal if the requested document is no longer open', () => {
    renderWorkspace({ activeSurface: 'missing-document' });

    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('terminal-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
  });
});

describe('WorkspaceContent actions and states', () => {
  it('forwards editor changes, editor saves, toolbar saves, and closes by document key', () => {
    const dirty = documentFixture('document:first', 'first.ts', {
      content: 'unsaved content',
    });
    const onDocumentChange = vi.fn();
    const onSaveDocument = vi.fn();
    const onCloseDocument = vi.fn();
    renderWorkspace({
      documents: [dirty],
      activeSurface: dirty.key,
      onDocumentChange,
      onSaveDocument,
      onCloseDocument,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Change editor content' }));
    expect(onDocumentChange).toHaveBeenCalledWith(dirty.key, 'edited in Monaco');

    fireEvent.click(screen.getByRole('button', { name: 'Save from editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save first.ts' }));
    expect(onSaveDocument).toHaveBeenNthCalledWith(1, dirty.key);
    expect(onSaveDocument).toHaveBeenNthCalledWith(2, dirty.key);

    fireEvent.click(screen.getByRole('button', { name: 'Close first.ts' }));
    expect(onCloseDocument).toHaveBeenCalledWith(dirty.key, expect.any(Function));
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      screen.getByRole('tab', { name: 'first.ts, unsaved changes' }).id,
    );
  });

  it('shows a polite loading surface without mounting Monaco', () => {
    const loading = documentFixture('document:first', 'first.ts', {
      loadState: 'loading',
      revision: null,
    });
    renderWorkspace({ documents: [loading], activeSurface: loading.key });

    expect(screen.getByRole('status')).toHaveTextContent('Opening first.ts…');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save first\.ts/i })).not.toBeInTheDocument();
  });

  it('shows an accessible load error and retries the matching document', () => {
    const failed = documentFixture('document:first', 'first.ts', {
      loadState: 'error',
      revision: null,
      error: { code: 'NOT_FOUND', message: 'The file moved.' },
    });
    const onRetryDocument = vi.fn();
    renderWorkspace({
      documents: [failed],
      activeSurface: failed.key,
      onRetryDocument,
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t open first.ts');
    expect(alert).toHaveTextContent('The file moved.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryDocument).toHaveBeenCalledWith(failed.key);
  });

  it('disables save while clean or saving and announces save failures', () => {
    const { rerender, props } = renderWorkspace({
      documents: [defaultDocuments[0]],
      activeSurface: defaultDocuments[0].key,
    });
    expect(screen.getByRole('button', { name: 'Save first.ts' })).toBeDisabled();

    const saving = documentFixture('document:first', 'first.ts', {
      content: 'unsaved content',
      saveState: 'saving',
    });
    rerender(<WorkspaceContent {...props} documents={[saving]} activeSurface={saving.key} />);
    expect(screen.getByRole('button', { name: 'Saving first.ts' })).toBeDisabled();

    const saveFailed = documentFixture('document:first', 'first.ts', {
      content: 'unsaved content',
      saveState: 'error',
      error: { code: 'PERMISSION_DENIED', message: 'The file is read-only.' },
    });
    rerender(<WorkspaceContent {...props} documents={[saveFailed]} activeSurface={saveFailed.key} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The file is read-only.');
    expect(screen.getByRole('button', { name: 'Save first.ts' })).toBeEnabled();
  });
});
