import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SearchOverlay from '../../src/renderer/components/SearchOverlay';

describe('SearchOverlay', () => {
  const defaultProps = {
    query: '',
    results: { resultIndex: 0, resultCount: 0 },
    visible: true,
    onQueryChange: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders nothing when not visible', () => {
    const { container } = render(
      <SearchOverlay {...defaultProps} visible={false} />,
    );
    expect(container.querySelector('.search-overlay')).toBeNull();
  });

  it('renders search input and buttons when visible', () => {
    render(<SearchOverlay {...defaultProps} />);

    expect(screen.getByTestId('search-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('search-input')).toBeInTheDocument();
    expect(screen.getByTestId('search-next')).toBeInTheDocument();
    expect(screen.getByTestId('search-prev')).toBeInTheDocument();
    expect(screen.getByTestId('search-close')).toBeInTheDocument();
    expect(screen.getByTestId('search-results')).toBeInTheDocument();
  });

  it('displays the current query value', () => {
    render(<SearchOverlay {...defaultProps} query="hello" />);

    const input = screen.getByTestId('search-input') as HTMLInputElement;
    expect(input.value).toBe('hello');
  });

  it('shows result count when there are matches', () => {
    render(
      <SearchOverlay
        {...defaultProps}
        query="test"
        results={{ resultIndex: 1, resultCount: 5 }}
      />,
    );

    expect(screen.getByTestId('search-results')).toHaveTextContent('2 of 5');
  });

  it('uses plain language when a query has no matches', () => {
    render(<SearchOverlay {...defaultProps} query="xyz" />);

    expect(screen.getByTestId('search-results')).toHaveTextContent('No matches');
  });

  it('shows empty results when no query', () => {
    render(<SearchOverlay {...defaultProps} query="" />);

    expect(screen.getByTestId('search-results')).toHaveTextContent('');
  });

  it('calls onQueryChange when typing in the input', () => {
    const onQueryChange = vi.fn();
    render(<SearchOverlay {...defaultProps} onQueryChange={onQueryChange} />);

    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'findme' } });
    expect(onQueryChange).toHaveBeenCalledWith('findme');
  });

  it('calls onNext on Enter key', () => {
    const onNext = vi.fn();
    render(<SearchOverlay {...defaultProps} query="test" onNext={onNext} />);

    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Enter' });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onPrev on Shift+Enter', () => {
    const onPrev = vi.fn();
    render(<SearchOverlay {...defaultProps} query="test" onPrev={onPrev} />);

    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Enter', shiftKey: true });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<SearchOverlay {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId('search-input'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onNext when next button is clicked', () => {
    const onNext = vi.fn();
    render(<SearchOverlay {...defaultProps} query="test" onNext={onNext} />);

    fireEvent.click(screen.getByTestId('search-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onPrev when prev button is clicked', () => {
    const onPrev = vi.fn();
    render(<SearchOverlay {...defaultProps} query="test" onPrev={onPrev} />);

    fireEvent.click(screen.getByTestId('search-prev'));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SearchOverlay {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId('search-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-focuses the input when becoming visible', () => {
    const { rerender } = render(
      <SearchOverlay {...defaultProps} visible={false} />,
    );

    // Re-render with visible=true
    rerender(<SearchOverlay {...defaultProps} visible={true} />);

    const input = screen.getByTestId('search-input');
    expect(document.activeElement).toBe(input);
  });
});
