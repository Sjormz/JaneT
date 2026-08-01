import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandHistoryPicker from '../../src/renderer/components/CommandHistoryPicker';

const entries = [
  { id: 'local-ok', command: 'npm test', startedAt: 1, durationMs: 2, exitCode: 0, context: { kind: 'local' as const, cwd: '/repo' } },
  { id: 'ssh-fail', command: 'deploy', startedAt: 2, durationMs: 3, exitCode: 1, context: { kind: 'ssh' as const, label: 'prod' } },
];

describe('CommandHistoryPicker', () => {
  it('searches command and context and filters context and outcome', () => {
    render(<CommandHistoryPicker visible entries={entries} onClose={() => {}} onSelect={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Command history' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Search command history' }), { target: { value: 'prod' } });
    expect(screen.getByRole('option', { name: /deploy/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /npm test/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Context'), { target: { value: 'local' } });
    expect(screen.queryByRole('option', { name: /deploy|npm test/ })).toBeNull();
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
});
