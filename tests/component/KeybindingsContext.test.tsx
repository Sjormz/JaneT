import { fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KeybindingsProvider, useKeybindings } from '../../src/renderer/KeybindingsContext';

function RegisteredShortcut({ handler }: { handler: () => void }) {
  const { on } = useKeybindings();
  useEffect(() => on('close-tab', handler), [handler, on]);
  return <div className="terminal-container"><textarea aria-label="Terminal input" /></div>;
}

describe('KeybindingsProvider terminal editing keys', () => {
  it('leaves terminal copy and interrupt keys to xterm even when an app action conflicts', () => {
    const handler = vi.fn();
    const view = render(
      <KeybindingsProvider initialBindings={{ 'close-tab': 'Ctrl+C' }}>
        <RegisteredShortcut handler={handler} />
      </KeybindingsProvider>,
    );

    fireEvent.keyDown(view.getByLabelText('Terminal input'), { key: 'c', ctrlKey: true });

    expect(handler).not.toHaveBeenCalled();
  });
});