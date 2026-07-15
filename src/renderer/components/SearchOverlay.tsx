import React, { useRef, useEffect } from 'react';
import { SearchIcon, ArrowUpIcon, ArrowDownIcon, SearchCloseIcon } from '../icons';

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
    <div
      className="search-overlay"
      data-testid="search-overlay"
      role="search"
      aria-label="Search terminal output"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <SearchIcon size="sm" className="search-leading" aria-hidden={true} />
      <input
        ref={inputRef}
        className="search-input"
        data-testid="search-input"
        type="text"
        placeholder="Search…"
        aria-label="Search terminal output"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === 'Escape') {
            onClose();
          }
        }}
      />
      <span
        className="search-results"
        data-testid="search-results"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {results.resultCount > 0
          ? `${results.resultIndex + 1}/${results.resultCount}`
          : query ? '0/0' : ''}
      </span>
      <button className="search-btn" data-testid="search-prev" onClick={onPrev} title="Previous (Shift+Enter)" aria-label="Previous match">
        <ArrowUpIcon size="sm" />
      </button>
      <button className="search-btn" data-testid="search-next" onClick={onNext} title="Next (Enter)" aria-label="Next match">
        <ArrowDownIcon size="sm" />
      </button>
      <button className="search-btn search-close" data-testid="search-close" onClick={onClose} title="Close (Esc)" aria-label="Close search">
        <SearchCloseIcon size="sm" />
      </button>
    </div>
  );
}
