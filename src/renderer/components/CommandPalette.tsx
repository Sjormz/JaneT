import React, { useState, useRef, useEffect, useCallback } from 'react';

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

  // Filter actions by query
  const filtered = query
    ? actions.filter(
        (a) =>
          a.label.toLowerCase().includes(query.toLowerCase()) ||
          a.category.toLowerCase().includes(query.toLowerCase()),
      )
    : actions;

  // Reset selection and focus when opening
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [visible]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

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
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
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
    <div className="command-palette-overlay" data-testid="command-palette" onMouseDown={onClose}>
      <div
        className="command-palette"
        data-testid="command-palette-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="command-palette-input-wrapper">
          <span className="command-palette-icon">⟩</span>
          <input
            ref={inputRef}
            className="command-palette-input"
            data-testid="command-palette-input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="command-palette-results" data-testid="command-palette-results">
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}

          {categories.map((category) => {
            const items = grouped[category];
            const catStart = categoryStartIndices[category];
            return (
              <div key={category} className="command-category">
                <div className="command-category-label">{category}</div>
                {items.map((action, i) => {
                  const flatIdx = catStart + i;
                  return (
                    <div
                      key={action.id}
                      className={`command-item ${flatIdx === selectedIndex ? 'selected' : ''}`}
                      data-testid={`command-item-${action.id}`}
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
