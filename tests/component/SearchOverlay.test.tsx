import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchOverlay from '../../src/renderer/components/SearchOverlay';

function props() {
  return {
    query: '', results: { resultIndex: 0, resultCount: 0 }, visible: true,
    onQueryChange: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn(),
  };
}

describe('SearchOverlay', () => {
  it('renders nothing when hidden', () => {
    const { container } = render(<SearchOverlay {...props()} visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes named search controls and the current query', () => {
    render(<SearchOverlay {...props()} query="hello" />);
    expect(screen.getByRole('search', { name: 'Search terminal output' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search terminal output' })).toHaveValue('hello');
    for (const name of ['Previous match', 'Next match', 'Close search']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it.each([
    ['matches', 'test', { resultIndex: 1, resultCount: 5 }, '2 of 5'],
    ['no matches', 'xyz', { resultIndex: 0, resultCount: 0 }, 'No matches'],
    ['no query', '', { resultIndex: 0, resultCount: 0 }, ''],
  ])('announces %s', (_label, query, results, text) => {
    render(<SearchOverlay {...props()} query={query} results={results} />);
    expect(screen.getByRole('status').textContent).toBe(text);
  });

  it('reports the changed query', () => {
    const handlers = props();
    render(<SearchOverlay {...handlers} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'findme' } });
    expect(handlers.onQueryChange).toHaveBeenCalledExactlyOnceWith('findme');
  });

  it.each([
    ['Enter', false, 'onNext'], ['Enter', true, 'onPrev'],
    ['Escape', false, 'onClose'], ['ArrowDown', false, null],
  ] as const)('routes %s (shift=%s) to only %s', (key, shiftKey, action) => {
    const handlers = props();
    render(<SearchOverlay {...handlers} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key, shiftKey });
    for (const name of ['onNext', 'onPrev', 'onClose'] as const) {
      expect(handlers[name]).toHaveBeenCalledTimes(name === action ? 1 : 0);
    }
    expect(handlers.onQueryChange).not.toHaveBeenCalled();
  });

  it.each([
    ['Next match', 'onNext'], ['Previous match', 'onPrev'], ['Close search', 'onClose'],
  ] as const)('routes the %s button to only %s', (label, action) => {
    const handlers = props();
    render(<SearchOverlay {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    for (const name of ['onNext', 'onPrev', 'onClose'] as const) {
      expect(handlers[name]).toHaveBeenCalledTimes(name === action ? 1 : 0);
    }
  });

  it('focuses and selects the existing query when opened', () => {
    const initial = { ...props(), query: 'selected query' };
    const { rerender } = render(<SearchOverlay {...initial} visible={false} />);
    rerender(<SearchOverlay {...initial} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, initial.query.length]);
  });
});
