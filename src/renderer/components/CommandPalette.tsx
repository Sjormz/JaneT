import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useModalFocus } from '../useModalFocus';
import { SearchIcon } from '../icons';

export interface CommandAction {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  handler: () => void;
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  actions: CommandAction[];
}

export default function CommandPalette({ visible, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Filter actions by query
  const filtered = query
    ? actions.filter(
        (a) =>
          a.label.toLowerCase().includes(query.toLowerCase()) ||
          a.category.toLowerCase().includes(query.toLowerCase()),
      )
    : actions;

  // Reset the query and selection when opening. Modal focus is managed below.
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [visible]);

  useModalFocus({
    open: visible,
    containerRef: panelRef,
    onClose,
    initialFocusSelector: '[data-testid="command-palette-input"]',
  });

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  const selectedActionId = filtered[selectedIndex]?.id;
  const selectedOptionId = selectedActionId
    ? `command-option-${selectedActionId.replace(/[^A-Za-z0-9_-]/g, '-')}`
    : undefined;

  useEffect(() => {
    if (!visible || !selectedOptionId) return;
    document.getElementById(selectedOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedOptionId, visible]);

  const executeSelected = useCallback(() => {
    if (filtered[selectedIndex]) {
      filtered[selectedIndex].handler();
      onClose();
    }
  }, [filtered, selectedIndex, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (filtered.length > 0) {
            setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (filtered.length > 0) setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          if (filtered.length > 0) setSelectedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          if (filtered.length > 0) setSelectedIndex(filtered.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          executeSelected();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered.length, executeSelected, onClose],
  );

  if (!visible) return null;

  // Group filtered actions by category
  const grouped: Record<string, CommandAction[]> = {};
  for (const action of filtered) {
    if (!grouped[action.category]) grouped[action.category] = [];
    grouped[action.category].push(action);
  }
  const categories = Object.keys(grouped);

  // Build a flat index-to-action mapping for keyboard selection
  let globalIdx = 0;
  const categoryStartIndices: Record<string, number> = {};
  for (const cat of categories) {
    categoryStartIndices[cat] = globalIdx;
    globalIdx += grouped[cat].length;
  }

  return (
    <div
      className="command-palette-overlay"
      data-testid="command-palette"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        className="command-palette"
        data-testid="command-palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="command-palette-input-wrapper">
          <SearchIcon size="md" className="command-palette-icon" />
          <input
            ref={inputRef}
            className="command-palette-input"
            data-testid="command-palette-input"
            type="text"
            placeholder="Search commands…"
            role="combobox"
            aria-label="Search commands"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={selectedOptionId}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        {filtered.length === 0 && (
          <div className="command-palette-empty" role="status">No matching commands</div>
        )}

        <div
          id="command-palette-results"
          className="command-palette-results"
          data-testid="command-palette-results"
          role="listbox"
          aria-label="Commands"
        >
          {categories.map((category) => {
            const items = grouped[category];
            const catStart = categoryStartIndices[category];
            return (
              <div
                key={category}
                className="command-category"
                role="group"
                aria-labelledby={`command-category-${categoryStartIndices[category]}`}
              >
                <div
                  id={`command-category-${categoryStartIndices[category]}`}
                  className="command-category-label"
                >
                  {category}
                </div>
                {items.map((action, i) => {
                  const flatIdx = catStart + i;
                  const optionId = `command-option-${action.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
                  return (
                    <div
                      key={action.id}
                      id={optionId}
                      className={`command-item ${flatIdx === selectedIndex ? 'selected' : ''}`}
                      data-testid={`command-item-${action.id}`}
                      role="option"
                      aria-selected={flatIdx === selectedIndex}
                      onClick={() => {
                        action.handler();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(flatIdx)}
                    >
                      <span className="command-item-label">{action.label}</span>
                      {action.shortcut && (
                        <span className="command-item-shortcut">{action.shortcut}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
