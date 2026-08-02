import { fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { KeybindingsProvider, useKeybindings } from '../../src/renderer/KeybindingsContext';

function RegisteredShortcut({
  action = 'close-tab',
  handler,
}: {
  action?: 'close-tab' | 'close-pane';
  handler: () => void;
}) {
  const { on } = useKeybindings();
  useEffect(() => on(action, handler), [action, handler, on]);
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

  it('runs only the first registered action when configured shortcuts collide', () => {
    const closeTab = vi.fn();
    const closePane = vi.fn();
    render(
      <KeybindingsProvider initialBindings={{
        'close-tab': 'Ctrl+W',
        'close-pane': 'Ctrl+W',
      }}>
        <RegisteredShortcut action="close-tab" handler={closeTab} />
        <RegisteredShortcut action="close-pane" handler={closePane} />
      </KeybindingsProvider>,
    );

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });

    expect(closeTab).toHaveBeenCalledOnce();
    expect(closePane).not.toHaveBeenCalled();
  });

  it('keeps the same collision winner after a handler re-registers', () => {
    const firstCloseTab = vi.fn();
    const nextCloseTab = vi.fn();
    const closePane = vi.fn();
    const bindings = {
      'close-tab': 'Ctrl+W',
      'close-pane': 'Ctrl+W',
    } as const;
    const view = render(
      <KeybindingsProvider initialBindings={bindings}>
        <RegisteredShortcut action="close-tab" handler={firstCloseTab} />
        <RegisteredShortcut action="close-pane" handler={closePane} />
      </KeybindingsProvider>,
    );

    view.rerender(
      <KeybindingsProvider initialBindings={bindings}>
        <RegisteredShortcut action="close-tab" handler={nextCloseTab} />
        <RegisteredShortcut action="close-pane" handler={closePane} />
      </KeybindingsProvider>,
    );
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });

    expect(firstCloseTab).not.toHaveBeenCalled();
    expect(nextCloseTab).toHaveBeenCalledOnce();
    expect(closePane).not.toHaveBeenCalled();
  });

  it('does not let a removed colliding action block a registered action', () => {
    const closeTab = vi.fn();
    const closePane = vi.fn();
    const view = render(
      <KeybindingsProvider initialBindings={{
        'close-tab': 'Ctrl+W',
        'close-pane': 'Ctrl+W',
      }}>
        <RegisteredShortcut action="close-tab" handler={closeTab} />
      </KeybindingsProvider>,
    );
    view.rerender(
      <KeybindingsProvider initialBindings={{
        'close-tab': 'Ctrl+W',
        'close-pane': 'Ctrl+W',
      }}>
        <RegisteredShortcut action="close-pane" handler={closePane} />
      </KeybindingsProvider>,
    );

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });

    expect(closeTab).not.toHaveBeenCalled();
    expect(closePane).toHaveBeenCalledOnce();
  });
});