import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConfirmationDialog from '../../src/renderer/components/ConfirmationDialog';

function renderDialog(callbacks?: { onConfirm?: () => void; onCancel?: () => void }) {
  const onConfirm = callbacks?.onConfirm ?? vi.fn();
  const onCancel = callbacks?.onCancel ?? vi.fn();

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Remove item</button>
        <ConfirmationDialog
          open={open}
          title="Remove saved item?"
          description={<span>This item cannot be restored automatically.</span>}
          confirmLabel="Remove"
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
        />
      </>
    );
  }

  render(<Harness />);
  return { onConfirm, onCancel };
}

describe('ConfirmationDialog', () => {
  it('portals an accessible alert dialog and puts initial focus on the safe action', async () => {
    const { onConfirm } = renderDialog();
    const opener = screen.getByRole('button', { name: 'Remove item' });

    fireEvent.click(opener);

    const dialog = screen.getByRole('alertdialog', { name: 'Remove saved item?' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog).toHaveAccessibleDescription('This item cannot be restored automatically.');
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
  });

  it('confirms only from the destructive action', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onConfirm, onCancel });

    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels on Escape and restores focus to the opener', async () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    const opener = screen.getByRole('button', { name: 'Remove item' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('cancels from the backdrop and keeps focus trapped while open', async () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Remove item' }));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Remove' });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();

    fireEvent.pointerDown(document.querySelector('.confirmation-dialog-overlay')!);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
