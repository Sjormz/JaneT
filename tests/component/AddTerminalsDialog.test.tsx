import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AddTerminalsDialog from '../../src/renderer/components/AddTerminalsDialog';

describe('Add terminals chooser', () => {
  it.each(['Terminal', 'Codex', 'Hermes', 'Claude', 'Custom'])('adds the requested number of %s terminals', async choice => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(<AddTerminalsDialog group={{ id: 'work', name: 'Work', directory: '/work/project' }} onSubmit={submit} onClose={close} />);
    expect(screen.getByRole('spinbutton', { name: 'Number of terminals' })).toHaveValue(1);
    expect(screen.getByRole('radio', { name: 'Terminal' })).toBeChecked();
    expect(screen.queryByRole('textbox', { name: /name/i })).toBeNull();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('radio', { name: choice }));
    if (choice === 'Custom') fireEvent.change(screen.getByRole('textbox', { name: 'Custom command' }), { target: { value: 'npm run dev' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add terminals' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    const leaves = (node: any): any[] => node.type === 'leaf' ? [node] : node.children.flatMap(leaves);
    const terminals = leaves(submit.mock.calls[0][0].root);
    expect(terminals).toHaveLength(3);
    for (const terminal of terminals) {
      expect(terminal.terminalType).toBe('local');
      expect(terminal.startupCommands).toEqual(choice === 'Terminal' ? undefined : [choice === 'Custom' ? 'npm run dev' : choice === 'Hermes' ? 'hermes --tui' : choice.toLowerCase()]);
    }
  });
});
