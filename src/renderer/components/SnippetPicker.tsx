import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PencilIcon, PlusIcon, SearchIcon, TrashIcon } from '../icons';
import { useModalFocus } from '../useModalFocus';
import { hasDuplicateSnippetName, type Snippet } from '../../shared/snippets';
import ConfirmationDialog from './ConfirmationDialog';

interface SnippetPickerProps {
  visible: boolean;
  onClose: () => void;
  snippets: Snippet[];
  onSave: (snippets: Snippet[]) => void;
  onPaste: (snippet: Snippet) => void;
}

type EditingSnippet = Pick<Snippet, 'id' | 'name' | 'content'>;

function freshSnippet(): EditingSnippet {
  return { id: crypto.randomUUID(), name: '', content: '' };
}

export default function SnippetPicker({ visible, onClose, snippets, onSave, onPaste }: SnippetPickerProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editing, setEditing] = useState<EditingSnippet | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Snippet | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? snippets.filter((snippet) => snippet.name.toLocaleLowerCase().includes(needle)) : snippets;
  }, [query, snippets]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSelectedIndex(0);
    setEditing(null);
    setError('');
  }, [visible]);

  useEffect(() => {
    if (selectedIndex >= filtered.length) setSelectedIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIndex]);

  useModalFocus({
    open: visible,
    containerRef: panelRef,
    onClose,
    initialFocusSelector: editing ? '[data-testid="snippet-name-input"]' : '[data-testid="snippet-search-input"]',
  });

  if (!visible) return null;

  const beginEditing = (snippet?: Snippet) => {
    setError('');
    setEditing(snippet ? { ...snippet } : freshSnippet());
  };
  const finishEditing = () => {
    setEditing(null);
    setError('');
  };
  const saveEditing = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      setError('Give the snippet a name.');
      return;
    }
    if (!editing.content.trim()) {
      setError('Snippet content cannot be empty.');
      return;
    }
    const existing = snippets.find((snippet) => snippet.id === editing.id);
    if (hasDuplicateSnippetName(snippets, name, editing.id)) {
      const duplicate = snippets.find((snippet) => snippet.id !== editing.id && snippet.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
      setError(`A snippet named “${duplicate?.name ?? name}” already exists.`);
      return;
    }
    const saved = { ...editing, name };
    onSave(existing ? snippets.map((snippet) => snippet.id === saved.id ? saved : snippet) : [...snippets, saved]);
    finishEditing();
  };
  const paste = (snippet: Snippet) => {
    onPaste(snippet);
    onClose();
  };
  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filtered[selectedIndex];
      if (selected) paste(selected);
    }
  };

  return (
    <div
      className="snippet-picker-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="snippet-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Snippets"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {editing ? (
          <form
            className="snippet-editor"
            onSubmit={(event) => {
              event.preventDefault();
              saveEditing();
            }}
          >
            <div className="snippet-editor-heading">
              <h2>{snippets.some((snippet) => snippet.id === editing.id) ? 'Edit snippet' : 'New snippet'}</h2>
              <button type="button" className="snippet-secondary-button" onClick={finishEditing}>Back</button>
            </div>
            <label className="form-field">
              <span>Name</span>
              <input
                data-testid="snippet-name-input"
                className="form-input"
                aria-label="Snippet name"
                value={editing.name}
                maxLength={120}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                placeholder="Deploy staging"
              />
            </label>
            <label className="form-field">
              <span>Content</span>
              <textarea
                className="form-input form-textarea snippet-content-input"
                aria-label="Snippet content"
                value={editing.content}
                maxLength={100_000}
                rows={8}
                onChange={(event) => setEditing({ ...editing, content: event.target.value })}
                placeholder="Command or multi-line text to paste"
              />
            </label>
            {error && <div className="snippet-error" role="alert">{error}</div>}
            <div className="snippet-editor-actions">
              <button type="button" className="snippet-secondary-button" onClick={finishEditing}>Cancel</button>
              <button type="submit" className="snippet-primary-button">Save snippet</button>
            </div>
          </form>
        ) : (
          <>
            <div className="snippet-picker-heading">
              <div>
                <h2>Snippets</h2>
                <p>Enter pastes text only; it never runs the command.</p>
              </div>
              <button type="button" className="snippet-primary-button" onClick={() => beginEditing()}>
                <PlusIcon size="sm" /> New snippet
              </button>
            </div>
            <div className="command-palette-input-wrapper">
              <SearchIcon size="md" className="command-palette-icon" />
              <input
                data-testid="snippet-search-input"
                className="command-palette-input"
                type="text"
                role="combobox"
                aria-label="Search snippets"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="snippet-results"
                aria-activedescendant={filtered[selectedIndex] ? `snippet-option-${filtered[selectedIndex].id}` : undefined}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder="Search snippets…"
              />
            </div>
            <div id="snippet-results" className="snippet-results" role="listbox" aria-label="Snippets">
              {filtered.length === 0 ? (
                <div className="command-palette-empty" role="status">No matching snippets</div>
              ) : filtered.map((snippet, index) => (
                <div
                  key={snippet.id}
                  id={`snippet-option-${snippet.id}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`snippet-item ${index === selectedIndex ? 'selected' : ''}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <button type="button" className="snippet-paste-button" onClick={() => paste(snippet)}>
                    <span className="snippet-item-name">{snippet.name}</span>
                    <span className="snippet-item-preview">{snippet.content.split('\n')[0]}</span>
                  </button>
                  <button type="button" className="snippet-icon-button" aria-label={`Edit ${snippet.name}`} onClick={() => beginEditing(snippet)}>
                    <PencilIcon size="sm" />
                  </button>
                  <button type="button" className="snippet-icon-button danger" aria-label={`Delete ${snippet.name}`} onClick={() => setDeleting(snippet)}>
                    <TrashIcon size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <ConfirmationDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'snippet'}?`}
        description="This permanently removes the saved snippet."
        confirmLabel="Delete snippet"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) onSave(snippets.filter((snippet) => snippet.id !== deleting.id));
          setDeleting(null);
        }}
      />
    </div>
  );
}
