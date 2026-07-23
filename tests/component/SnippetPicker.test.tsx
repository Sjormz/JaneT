import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SnippetPicker from '../../src/renderer/components/SnippetPicker';

const snippets = [
  { id: 'deploy', name: 'Deploy app', content: 'npm run deploy' },
  { id: 'logs', name: 'Follow logs', content: 'docker compose logs -f' },
];

describe('SnippetPicker', () => {
  it('shows a creation empty state when no snippets are saved', () => {
    render(<SnippetPicker visible onClose={vi.fn()} snippets={[]} onSave={vi.fn()} onPaste={vi.fn()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No snippets yet');
    expect(status).toHaveTextContent('Save reusable terminal text to paste it quickly.');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search snippets' }), { target: { value: 'missing' } });
    expect(status).toHaveTextContent('No snippets yet');
    expect(status).not.toHaveTextContent('No snippets match');
  });

  it('identifies an empty search as no matching snippets', () => {
    render(<SnippetPicker visible onClose={vi.fn()} snippets={snippets} onSave={vi.fn()} onPaste={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search snippets' }), { target: { value: 'missing' } });

    expect(screen.getByRole('status')).toHaveTextContent('No snippets match “missing”');
  });

  it('filters snippets by name and pastes the selected snippet without adding a newline', () => {
    const onPaste = vi.fn();
    render(<SnippetPicker visible onClose={vi.fn()} snippets={snippets} onSave={vi.fn()} onPaste={onPaste} />);

    const search = screen.getByRole('combobox', { name: 'Search snippets' });
    fireEvent.change(search, { target: { value: 'logs' } });
    fireEvent.keyDown(search, { key: 'Enter' });

    expect(onPaste).toHaveBeenCalledWith(snippets[1]);
    expect(onPaste.mock.calls[0][0].content).not.toMatch(/\n$/);
  });

  it('creates a snippet and rejects a duplicate name without changing saved snippets', () => {
    const onSave = vi.fn();
    render(<SnippetPicker visible onClose={vi.fn()} snippets={snippets} onSave={onSave} onPaste={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Snippet name' }), { target: { value: ' deploy APP ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Snippet content' }), { target: { value: 'echo duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

    expect(screen.getByText('A snippet named “Deploy app” already exists.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Snippet name' }), { target: { value: 'Restart app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

    expect(onSave).toHaveBeenCalledWith([
      ...snippets,
      expect.objectContaining({ name: 'Restart app', content: 'echo duplicate' }),
    ]);
  });

  it('edits a saved snippet from the picker', () => {
    const onSave = vi.fn();
    render(<SnippetPicker visible onClose={vi.fn()} snippets={snippets} onSave={onSave} onPaste={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Deploy app' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Snippet content' }), { target: { value: 'npm run deploy -- --dry-run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

    expect(onSave).toHaveBeenCalledWith([
      { id: 'deploy', name: 'Deploy app', content: 'npm run deploy -- --dry-run' },
      snippets[1],
    ]);
  });

  it('keeps the picker open when a deletion is cancelled', () => {
    const onClose = vi.fn();
    render(<SnippetPicker visible onClose={onClose} snippets={snippets} onSave={vi.fn()} onPaste={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Deploy app' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Snippets' })).toBeInTheDocument();
  });
});
