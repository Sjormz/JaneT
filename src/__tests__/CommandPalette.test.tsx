import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette, { CommandAction } from '../renderer/components/CommandPalette';

const sampleActions: CommandAction[] = [
  { id: 'new-terminal', label: 'New Terminal', category: 'Tab', shortcut: 'Ctrl+N', handler: vi.fn() },
  { id: 'close-tab', label: 'Close Tab', category: 'Tab', shortcut: 'Ctrl+W', handler: vi.fn() },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'View', shortcut: 'Ctrl+B', handler: vi.fn() },
  { id: 'font-increase', label: 'Increase Font Size', category: 'Settings', handler: vi.fn() },
  { id: 'theme-dracula', label: 'Theme: Dracula', category: 'Theme', handler: vi.fn() },
];

describe('CommandPalette', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <CommandPalette visible={false} onClose={vi.fn()} actions={sampleActions} />,
    );
    expect(container.querySelector('.command-palette-overlay')).toBeNull();
  });

  it('renders the palette panel when visible', () => {
    render(<CommandPalette visible={true} onClose={vi.fn()} actions={sampleActions} />);

    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    expect(screen.getByTestId('command-palette-panel')).toBeInTheDocument();
    expect(screen.getByTestId('command-palette-input')).toBeInTheDocument();
    expect(screen.getByTestId('command-palette-results')).toBeInTheDocument();
  });

  it('shows all actions grouped by category', () => {
    render(<CommandPalette visible={true} onClose={vi.fn()} actions={sampleActions} />);

    expect(screen.getByText('Tab')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();

    expect(screen.getByText('New Terminal')).toBeInTheDocument();
    expect(screen.getByText('Close Tab')).toBeInTheDocument();
    expect(screen.getByText('Toggle Sidebar')).toBeInTheDocument();
    expect(screen.getByText('Increase Font Size')).toBeInTheDocument();
    expect(screen.getByText('Theme: Dracula')).toBeInTheDocument();
  });

  it('shows keyboard shortcuts', () => {
    render(<CommandPalette visible={true} onClose={vi.fn()} actions={sampleActions} />);

    expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+W')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+B')).toBeInTheDocument();
  });

  it('filters actions by query', () => {
    render(<CommandPalette visible={true} onClose={vi.fn()} actions={sampleActions} />);

    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'theme' } });

    // Should show Theme category and Theme: Dracula
    expect(screen.getByText('Theme: Dracula')).toBeInTheDocument();
    // Should NOT show Tab actions
    expect(screen.queryByText('New Terminal')).toBeNull();
    expect(screen.queryByText('Close Tab')).toBeNull();
  });

  it('executes handler when clicking an action', () => {
    const handler = vi.fn();
    const onClose = vi.fn();
    const actions: CommandAction[] = [
      { id: 'test-action', label: 'Test Action', category: 'General', handler },
    ];

    render(<CommandPalette visible={true} onClose={onClose} actions={actions} />);

    fireEvent.click(screen.getByTestId('command-item-test-action'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('executes selected action on Enter and closes', () => {
    const handler = vi.fn();
    const onClose = vi.fn();
    const actions: CommandAction[] = [
      { id: 'test-action', label: 'Test Action', category: 'General', handler },
    ];

    render(<CommandPalette visible={true} onClose={onClose} actions={actions} />);

    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates with arrow keys', () => {
    const actions: CommandAction[] = [
      { id: 'first', label: 'First Action', category: 'General', handler: vi.fn() },
      { id: 'second', label: 'Second Action', category: 'General', handler: vi.fn() },
    ];

    render(<CommandPalette visible={true} onClose={vi.fn()} actions={actions} />);

    const input = screen.getByTestId('command-palette-input');

    // First item should be selected by default
    const firstItem = screen.getByTestId('command-item-first');
    expect(firstItem.classList.contains('selected')).toBe(true);

    // Arrow down to second
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByTestId('command-item-second').classList.contains('selected')).toBe(true);
    expect(firstItem.classList.contains('selected')).toBe(false);

    // Arrow up back to first
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(firstItem.classList.contains('selected')).toBe(true);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<CommandPalette visible={true} onClose={onClose} actions={sampleActions} />);

    const input = screen.getByTestId('command-palette-input');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no actions match', () => {
    render(<CommandPalette visible={true} onClose={vi.fn()} actions={sampleActions} />);

    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: 'zzzzz_nonexistent' } });

    expect(screen.getByText('No matching commands')).toBeInTheDocument();
  });

  it('closes when overlay backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<CommandPalette visible={true} onClose={onClose} actions={sampleActions} />);

    // Click the overlay (backdrop), not the panel
    fireEvent.mouseDown(screen.getByTestId('command-palette'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking the panel', () => {
    const onClose = vi.fn();
    render(<CommandPalette visible={true} onClose={onClose} actions={sampleActions} />);

    // Click inside the panel
    fireEvent.mouseDown(screen.getByTestId('command-palette-panel'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
