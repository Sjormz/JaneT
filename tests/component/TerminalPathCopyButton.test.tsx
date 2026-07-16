import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TerminalPathCopyButton from '../../src/renderer/components/TerminalPathCopyButton';

describe('TerminalPathCopyButton', () => {
  it('copies a safe path and announces success through a native keyboard-operable button', async () => {
    const onCopyPath = vi.fn().mockResolvedValue(undefined);
    render(
      <TerminalPathCopyButton
        path="/repo/drag target.txt"
        label="drag target.txt"
        onCopyPath={onCopyPath}
      />,
    );

    const button = screen.getByRole('button', { name: 'Copy path for drag target.txt' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('draggable', 'false');

    fireEvent.click(button);

    await waitFor(() => expect(onCopyPath).toHaveBeenCalledWith('/repo/drag target.txt'));
    expect(screen.getByRole('status')).toHaveTextContent('Copied path for drag target.txt');
    expect(button).toHaveAttribute('data-state', 'copied');
  });

  it('announces bridge failures without throwing from the row action', async () => {
    const onCopyPath = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    render(
      <TerminalPathCopyButton path="/repo/file.ts" label="file.ts" onCopyPath={onCopyPath} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy path for file.ts' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't copy path for file.ts");
    });
  });

  it('disables paths that cannot be pasted safely', () => {
    const onCopyPath = vi.fn().mockResolvedValue(undefined);
    render(
      <TerminalPathCopyButton path={'/repo/file\nwhoami'} label="unsafe.txt" onCopyPath={onCopyPath} />,
    );

    const button = screen.getByRole('button', { name: 'Copy path for unsafe.txt' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('title', 'Path cannot be pasted safely');
    fireEvent.click(button);
    expect(onCopyPath).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Path for unsafe.txt cannot be pasted safely');
  });

  it('ignores stale async completions when a newer copy finishes first', async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const second = new Promise<void>((resolve) => { resolveSecond = resolve; });
    const onCopyPath = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    render(
      <TerminalPathCopyButton path="/repo/file.ts" label="file.ts" onCopyPath={onCopyPath} />,
    );
    const button = screen.getByRole('button', { name: 'Copy path for file.ts' });

    fireEvent.click(button);
    fireEvent.click(button);
    resolveSecond();
    await waitFor(() => expect(button).toHaveAttribute('data-state', 'copied'));

    rejectFirst(new Error('older request failed'));
    await Promise.resolve();
    expect(button).toHaveAttribute('data-state', 'copied');
    expect(screen.getByRole('status')).toHaveTextContent('Copied path for file.ts');
  });
});
