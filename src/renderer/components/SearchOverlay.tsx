import React, { useRef, useEffect } from 'react';

interface SearchResults {
  resultIndex: number;
  resultCount: number;
}

interface SearchOverlayProps {
  query: string;
  results: SearchResults;
  visible: boolean;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export default function SearchOverlay({
  query,
  results,
  visible,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="search-overlay" data-testid="search-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="search-input"
        data-testid="search-input"
        type="text"
        placeholder="Search..."
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
              onPrev();
            } else {
              onNext();
            }
          } else if (e.key === 'Escape') {
            onClose();
          }
        }}
      />
      <span className="search-results" data-testid="search-results">
        {results.resultCount > 0
          ? `${results.resultIndex + 1}/${results.resultCount}`
          : query ? '0/0' : ''}
      </span>
      <button
        className="search-btn"
        data-testid="search-prev"
        onClick={onPrev}
        title="Previous (Shift+Enter)"
        tabIndex={-1}
      >
        ▲
      </button>
      <button
        className="search-btn"
        data-testid="search-next"
        onClick={onNext}
        title="Next (Enter)"
        tabIndex={-1}
      >
        ▼
      </button>
      <button
        className="search-btn search-close"
        data-testid="search-close"
        onClick={onClose}
        title="Close (Escape)"
        tabIndex={-1}
      >
        ✕
      </button>
    </div>
  );
}
