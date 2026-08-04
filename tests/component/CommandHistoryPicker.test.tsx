import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandHistoryPicker from '../../src/renderer/components/CommandHistoryPicker';

const entries = [
  { id: 'local-ok', command: 'npm test', startedAt: 1, durationMs: 2, exitCode: 0, context: { kind: 'local' as const, cwd: '/repo' } },
  { id: 'ssh-fail', command: 'deploy', startedAt: 2, durationMs: 3, exitCode: 1, context: { kind: 'ssh' as const, label: 'prod' } },
];

describe('CommandHistoryPicker', () => {
  it('does not display or search local working-directory paths', () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Command history' });

    expect(dialog).not.toHaveTextContent('/repo');
    fireEvent.change(screen.getByRole('combobox', { name: 'Search command history' }), { target: { value: '/repo' } });
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
  });

  it('does not show context or outcome filter dropdowns', () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);

    expect(screen.queryByLabelText('Context')).toBeNull();
    expect(screen.queryByLabelText('Outcome')).toBeNull();
  });

  it('searches command text and SSH labels', () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Command history' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Search command history' }), { target: { value: 'prod' } });
    expect(screen.getByRole('option', { name: /deploy/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /npm test/ })).toBeNull();
  });

  it('focuses search first and makes the selected command the list Tab stop', async () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);
    const search = screen.getByRole('combobox', { name: 'Search command history' });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');

    await waitFor(() => expect(search).toHaveFocus());
    expect(options.map((option) => option.tabIndex)).toEqual([0, -1]);
    fireEvent.keyDown(search, { key: 'Tab' });
    expect(options[0]).toHaveFocus();
  });

  it('moves focus through commands with the arrow, Home, and End keys', async () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);
    const search = screen.getByRole('combobox', { name: 'Search command history' });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');

    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(options[1], { key: 'ArrowUp' });
    expect(options[0]).toHaveFocus();
    fireEvent.keyDown(options[0], { key: 'End' });
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(options[1], { key: 'Home' });
    expect(options[0]).toHaveFocus();
  });

  it('selects an option when assistive focus moves to it directly', () => {
    const onSelect = vi.fn();
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={onSelect} />);
    const options = within(screen.getByRole('listbox')).getAllByRole('option');

    fireEvent.focus(options[1]);
    fireEvent.keyDown(options[1], { key: 'Enter' });

    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
  });

  it('returns from the command list to search with Shift+Tab', async () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);
    const search = screen.getByRole('combobox', { name: 'Search command history' });
    const firstOption = within(screen.getByRole('listbox')).getAllByRole('option')[0];

    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: 'Tab' });
    fireEvent.keyDown(firstOption, { key: 'Tab', shiftKey: true });

    expect(search).toHaveFocus();
  });

  it('keeps Remove and Close in the modal Tab order after the command list', async () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} onRemove={() => {}} />);
    const search = screen.getByRole('combobox', { name: 'Search command history' });
    const firstOption = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    const remove = screen.getByRole('button', { name: 'Remove npm test from command history' });
    const close = screen.getByRole('button', { name: 'Close command history' });

    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: 'Tab' });
    fireEvent.keyDown(firstOption, { key: 'Tab' });
    expect(remove).toHaveFocus();
    fireEvent.keyDown(remove, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(remove).toHaveFocus();
  });

  it('navigates by keyboard, selects once unchanged, and closes on Escape', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<CommandHistoryPicker visible entries={entries} onClose={onClose} onSelect={onSelect} />);
    const search = screen.getByRole('combobox', { name: 'Search command history' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(entries[1]);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('provides a visible close action for mouse users', () => {
    const onClose = vi.fn();
    render(<CommandHistoryPicker visible entries={entries} onClose={onClose} onSelect={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close command history' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('removes an entry without selecting it or closing the picker', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    render(<CommandHistoryPicker visible entries={entries} onClose={onClose} onSelect={onSelect} onRemove={onRemove} />);

    const option = screen.getByRole('option', { name: 'npm test' });
    const remove = screen.getByRole('button', { name: 'Remove npm test from command history' });
    fireEvent.keyDown(option, { key: 'Tab' });
    expect(remove).toHaveFocus();
    fireEvent.click(remove);

    expect(onRemove).toHaveBeenCalledWith(entries[0]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Search command history' })).toHaveFocus();
  });
});
