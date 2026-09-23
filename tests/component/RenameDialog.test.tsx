import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RenameDialog from '../../src/renderer/components/RenameDialog';

describe('RenameDialog', () => {
  it('resets the input when the rename target changes', () => {
    const props = {
      open: true,
      onSave: vi.fn(),
      onCancel: vi.fn(),
      fallbackFocus: () => null,
    };
    const { rerender } = render(
      <RenameDialog {...props} title="Rename terminal" inputLabel="Terminal name" initialValue="Right" />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal name' }), { target: { value: 'Tests' } });
    rerender(
      <RenameDialog {...props} title="Rename tab" inputLabel="Tab name" initialValue="Two panes" />,
    );

    expect(screen.getByRole('textbox', { name: 'Tab name' })).toHaveValue('Two panes');
  });
});
