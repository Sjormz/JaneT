import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeybindingsProvider } from '../../src/renderer/KeybindingsContext';
import ShortcutEditor from '../../src/renderer/components/ShortcutEditor';
import { DEFAULT_KEYBINDINGS } from '../../src/renderer/keybindings';

function renderEditor(onSave: (bindings: typeof DEFAULT_KEYBINDINGS) => void) {
  return render(
    <KeybindingsProvider initialBindings={{ 'close-tab': 'Alt+X' }} onSave={onSave}>
      <ShortcutEditor />
    </KeybindingsProvider>,
  );
}

describe('ShortcutEditor', () => {
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
