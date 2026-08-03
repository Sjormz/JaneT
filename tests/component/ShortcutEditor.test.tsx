import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeybindingsProvider } from '../../src/renderer/KeybindingsContext';
import ShortcutEditor from '../../src/renderer/components/ShortcutEditor';
import { DEFAULT_KEYBINDINGS } from '../../src/renderer/keybindings';

function renderEditor(
  onSave: (bindings: typeof DEFAULT_KEYBINDINGS) => void,
  onClose = () => {},
) {
  return render(
    <KeybindingsProvider initialBindings={{ 'close-tab': 'Alt+X' }} onSave={onSave}>
      <ShortcutEditor open onClose={onClose} />
    </KeybindingsProvider>,
  );
}

describe('ShortcutEditor', () => {
  it('closes from its visible action, Escape, and backdrop', () => {
    const onClose = vi.fn();
    const { container } = renderEditor(vi.fn(), onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(container.ownerDocument.querySelector('.workspace-modal-overlay')!);

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('lists configurable actions without assigning every action a default', async () => {
    const onSave = vi.fn();
    renderEditor(onSave);

    expect(screen.getByRole('button', { name: /open settings \(currently Ctrl\+,\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maximize or restore current pane \(currently unassigned\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open command history \(currently unassigned\)/i })).toBeInTheDocument();
  });

  it('clears an assigned shortcut with Backspace', async () => {
    const onSave = vi.fn();
    renderEditor(onSave);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: /close current tab \(currently Alt\+X\)/i }));
    const capture = screen.getByRole('textbox', { name: /press a shortcut for close current tab/i });
    fireEvent.keyDown(capture, { key: 'Backspace' });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ 'close-tab': '' }));
    expect(screen.getByRole('button', { name: /close current tab \(currently unassigned\)/i })).toBeInTheDocument();
  });

  it('captures standalone function keys but rejects unmodified printable keys', async () => {
    const onSave = vi.fn();
    renderEditor(onSave);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: /rename current terminal \(currently F2\)/i }));
    const capture = screen.getByRole('textbox', { name: /press a shortcut for rename current terminal/i });
    fireEvent.keyDown(capture, { key: 'q' });
    expect(capture).toBeInTheDocument();

    fireEvent.keyDown(capture, { key: 'F3' });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ 'rename-pane': 'F3' }));
    expect(screen.getByRole('button', { name: /rename current terminal \(currently F3\)/i })).toBeInTheDocument();
  });

  it('waits for a non-modifier key before saving a chord', async () => {
    const onSave = vi.fn();
    renderEditor(onSave);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: /open snippets \(currently unassigned\)/i }));
    const capture = screen.getByRole('textbox', { name: /press a shortcut for open snippets/i });
    fireEvent.keyDown(capture, { key: 'Control', ctrlKey: true });

    expect(onSave).toHaveBeenCalledOnce();
    expect(capture).toBeInTheDocument();

    fireEvent.keyDown(capture, { key: 's', ctrlKey: true, shiftKey: true });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ 'snippets-toggle': 'Ctrl+Shift+S' }));
  });

  it('preserves custom shortcuts when reset confirmation is cancelled', async () => {
    const onSave = vi.fn();
    renderEditor(onSave);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    const resetButton = screen.getByRole('button', { name: /reset shortcuts to defaults/i });
    fireEvent.click(resetButton);

    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('alertdialog', { name: /reset all keyboard shortcuts/i })).toBeInTheDocument();
    expect(screen.getByText(/replaces every custom keyboard shortcut with JaneT’s defaults/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close current tab \(currently Alt\+X\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onSave).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    fireEvent.click(resetButton);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(onSave).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /close current tab \(currently Alt\+X\)/i })).toBeInTheDocument();
  });

  it('resets shortcuts exactly once after explicit confirmation', async () => {
    const onSave = vi.fn();
    renderEditor(onSave);
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: /reset shortcuts to defaults/i }));
    expect(onSave).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: /^reset shortcuts$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenLastCalledWith(DEFAULT_KEYBINDINGS);
    expect(screen.getByRole('button', { name: /close current tab \(currently Ctrl\+W\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
