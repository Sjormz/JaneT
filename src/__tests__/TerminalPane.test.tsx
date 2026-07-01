import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { KeybindingsProvider } from '../renderer/KeybindingsContext';

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

class MockAddonFit {
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
}

class MockAddonSearch {
  onDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }));
  findNext = vi.fn();
  findPrevious = vi.fn();
}

class MockTerminal {
  static instances: MockTerminal[] = [];

  options: Record<string, unknown> = {};
  element: HTMLElement | undefined;
  parser = {
    registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
  };
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  attachCustomKeyEventHandler = vi.fn();
  write = vi.fn();

  constructor(options: Record<string, unknown>) {
    this.options = options;
    MockTerminal.instances.push(this);
  }
}

const terminalCreate = vi.fn(() => Promise.resolve({ pid: 123 }));
const terminalResize = vi.fn(() => Promise.resolve());
const terminalWrite = vi.fn(() => Promise.resolve());
const terminalDestroy = vi.fn(() => Promise.resolve());
const sshCreateShell = vi.fn(() => Promise.resolve({ connected: true }));
const sshResizeShell = vi.fn(() => Promise.resolve());
const sshWriteShell = vi.fn(() => Promise.resolve());
const onTerminalData = vi.fn(() => vi.fn());

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: MockAddonFit,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: MockAddonSearch,
}));

vi.mock('../renderer/components/SearchOverlay', () => ({
  default: () => null,
}));

vi.mock('../renderer/components/SSHConnectionNotice', () => ({
  default: () => null,
}));

vi.mock('../renderer/osc7', () => ({
  fileUrlToPath: vi.fn(() => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  MockTerminal.instances = [];
  MockTerminal.prototype.open = vi.fn(function open(this: MockTerminal, parent: HTMLElement) {
    if (!this.element) this.element = document.createElement('div');
    this.element.dataset.testid = 'xterm-dom';
    parent.appendChild(this.element);
  });
  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: {
      terminalCreate,
      terminalResize,
      terminalWrite,
      terminalDestroy,
      onTerminalData,
      sshCreateShell,
      sshResizeShell,
      sshWriteShell,
    },
  });
});

async function loadTerminalPane() {
  return import('../renderer/components/TerminalPane');
}

describe('TerminalPane SSH reinitialization', () => {
  it('creates a new SSH shell when the pane switches from a local terminal to SSH props', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onReady = vi.fn();
    const onRemoved = vi.fn();

    const { rerender } = render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-local"
          tabType="local"
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(sshCreateShell).not.toHaveBeenCalled();

    rerender(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh"
          tabType="ssh"
          sshSessionId="ssh-17"
          sshSessionLabel="skynet"
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => {
      expect(sshCreateShell).toHaveBeenCalledTimes(1);
    });
    expect(sshCreateShell).toHaveBeenCalledWith({
      id: 'ssh-17',
      termId: 'term-ssh',
      cols: 80,
      rows: 24,
    });
  });

  it('reuses the xterm instance when the same pane remounts during a split reshape', async () => {
    vi.useFakeTimers();
    const { default: TerminalPane } = await loadTerminalPane();
    const onReady = vi.fn();
    const onRemoved = vi.fn();

    const { unmount } = render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-reused"
          tabType="local"
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(1);
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(MockTerminal.instances[0].dispose).not.toHaveBeenCalled();

    unmount();

    expect(onRemoved).toHaveBeenCalledWith('term-reused');
    expect(MockTerminal.instances[0].dispose).not.toHaveBeenCalled();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-reused"
          tabType="local"
          hasSession
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(1);
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);

    expect(MockTerminal.instances[0].dispose).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});
