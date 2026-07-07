import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { KeybindingsProvider } from '../../src/renderer/KeybindingsContext';

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();

  constructor(private callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }

  trigger() {
    this.callback([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

class MockAddonFit {
  static instances: MockAddonFit[] = [];
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));

  constructor() {
    MockAddonFit.instances.push(this);
  }
}

class MockAddonSearch {
  onDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }));
  findNext = vi.fn();
  findPrevious = vi.fn();
}

class MockUnicode11Addon {}

class MockTerminal {
  static instances: MockTerminal[] = [];

  options: Record<string, unknown> = {};
  element: HTMLElement | undefined;
  parser = {
    registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
  };
  unicode = { activeVersion: '6' };
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  attachCustomKeyEventHandler = vi.fn();
  write = vi.fn();
  refresh = vi.fn();
  rows = 24;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    MockTerminal.instances.push(this);
  }
}

const terminalCreate = vi.fn(() => Promise.resolve({ pid: 123 }));
const terminalResize = vi.fn(() => Promise.resolve());
const terminalWrite = vi.fn(() => Promise.resolve());
const terminalDestroy = vi.fn(() => Promise.resolve());
let sshCreateShellImpl: () => Promise<unknown> = () => Promise.resolve({ connected: true });
const sshCreateShell = vi.fn(() => sshCreateShellImpl());
const sshResizeShell = vi.fn(() => Promise.resolve());
const sshWriteShell = vi.fn(() => Promise.resolve());
let terminalDataHandler: ((params: { id: string; data: string }) => void) | null = null;
const onTerminalData = vi.fn((cb: (params: { id: string; data: string }) => void) => {
  terminalDataHandler = cb;
  return () => { terminalDataHandler = null; };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: MockAddonFit,
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: MockUnicode11Addon,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: MockAddonSearch,
}));

vi.mock('../../src/renderer/components/SearchOverlay', () => ({
  default: () => null,
}));

vi.mock('../../src/renderer/osc7', () => ({
  fileUrlToPath: vi.fn(() => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  MockTerminal.instances = [];
  MockAddonFit.instances = [];
  MockResizeObserver.instances = [];
  MockTerminal.prototype.open = vi.fn(function open(this: MockTerminal, parent: HTMLElement) {
    if (!this.element) this.element = document.createElement('div');
    this.element.dataset.testid = 'xterm-dom';
    parent.appendChild(this.element);
  });
  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);
  sshCreateShellImpl = () => Promise.resolve({ connected: true });
  terminalDataHandler = null;
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
  return import('../../src/renderer/components/TerminalPane');
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
      cols: 120,
      rows: 40,
    });
  });

  it('opens the SSH shell after a restored pane switches from pending to ready', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const props = {
      termId: 'term-restored-ssh',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-restored',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };

    const { rerender } = render(
      <KeybindingsProvider>
        <TerminalPane {...props} sshShellReady={false} />
      </KeybindingsProvider>,
    );

    expect(sshCreateShell).not.toHaveBeenCalled();

    rerender(
      <KeybindingsProvider>
        <TerminalPane {...props} sshShellReady />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    expect(sshCreateShell).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ssh-restored',
      termId: 'term-restored-ssh',
    }));
  });

  it('loads Unicode 11 width data before terminal output arrives', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-unicode"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    const term = MockTerminal.instances[0];
    expect(term.loadAddon.mock.calls[0][0]).toBeInstanceOf(MockUnicode11Addon);
    expect(term.unicode.activeVersion).toBe('11');
  });

  it('propagates measured window/container resizes to the local pty and repaints', async () => {
    vi.useFakeTimers();
    try {
      const { default: TerminalPane } = await loadTerminalPane();
      render(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-resize"
            tabType="local"
            onReady={vi.fn()}
            onRemoved={vi.fn()}
            themeName="tokyo-night"
          />
        </KeybindingsProvider>,
      );

      terminalResize.mockClear();
      const term = MockTerminal.instances[0];
      const fit = MockAddonFit.instances[0];
      fit.proposeDimensions.mockReturnValue({ cols: 132, rows: 37 });
      MockResizeObserver.instances[0].trigger();
      await vi.advanceTimersByTimeAsync(50);

      expect(fit.fit).toHaveBeenCalled();
      expect(terminalResize).toHaveBeenCalledWith({ id: 'term-resize', cols: 132, rows: 37 });
      expect(term.refresh).toHaveBeenCalledWith(0, 23);

      terminalResize.mockClear();
      MockResizeObserver.instances[0].trigger();
      await vi.advanceTimersByTimeAsync(50);
      expect(terminalResize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  it('forces cached xterm to repaint when returning to an SSH tab', async () => {
    vi.useFakeTimers();
    try {
      const { default: TerminalPane } = await loadTerminalPane();
      const onReady = vi.fn();
      const onRemoved = vi.fn();

      const first = render(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-ssh-cached"
            tabType="ssh"
            sshSessionId="ssh-cached"
            onReady={onReady}
            onRemoved={onRemoved}
            themeName="tokyo-night"
          />
        </KeybindingsProvider>,
      );

      const term = MockTerminal.instances[0];
      term.refresh.mockClear();
      first.unmount();

      render(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-ssh-cached"
            tabType="ssh"
            sshSessionId="ssh-cached"
            hasSession
            onReady={onReady}
            onRemoved={onRemoved}
            themeName="tokyo-night"
          />
        </KeybindingsProvider>,
      );

      expect(MockTerminal.instances).toHaveLength(1);
      expect(term.refresh).toHaveBeenCalledWith(0, 23);
      await vi.runAllTimersAsync();
      expect(term.refresh).toHaveBeenCalledWith(0, 23);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reattaches an SSH shell when an inactive tab remounts after the cached xterm was explicitly disposed', async () => {
    vi.useFakeTimers();
    try {
      const { default: TerminalPane, disposeCachedTerminal } = await loadTerminalPane();
      const onReady = vi.fn();
      const onRemoved = vi.fn();

      const first = render(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-ssh-remount"
            tabType="ssh"
            sshSessionId="ssh-remount"
            onReady={onReady}
            onRemoved={onRemoved}
            themeName="tokyo-night"
          />
        </KeybindingsProvider>,
      );

      await vi.runAllTimersAsync();
      expect(sshCreateShell).toHaveBeenCalledTimes(1);

      first.unmount();
      disposeCachedTerminal('term-ssh-remount');

      render(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-ssh-remount"
            tabType="ssh"
            sshSessionId="ssh-remount"
            hasSession
            onReady={onReady}
            onRemoved={onRemoved}
            themeName="tokyo-night"
          />
        </KeybindingsProvider>,
      );

      await vi.runAllTimersAsync();
      expect(sshCreateShell).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TerminalPane SSH shell output', () => {
  it('never renders a blocking SSH notice overlay while the remote shell opens', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    let resolveShell: (value: unknown) => void = () => {};
    sshCreateShellImpl = () => new Promise((res) => { resolveShell = res; });

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh"
          tabType="ssh"
          sshSessionId="ssh-1"
          sshSessionLabel="box"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(document.querySelector('[data-testid="ssh-terminal-notice"]')).toBeNull();
    resolveShell({ connected: true });
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    expect(document.querySelector('[data-testid="ssh-terminal-notice"]')).toBeNull();
  });

  it('writes remote SSH output directly into xterm', async () => {
    const { default: TerminalPane } = await loadTerminalPane();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-2"
          tabType="ssh"
          sshSessionId="ssh-2"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(terminalDataHandler).toBeTruthy());
    terminalDataHandler!({ id: 'term-ssh-2', data: 'terminal.shop output' });

    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith('terminal.shop output');
    expect(document.querySelector('[data-testid="ssh-terminal-notice"]')).toBeNull();
  });

  it('writes SSH shell-open failures into xterm instead of showing retry buttons', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    sshCreateShellImpl = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:22'));

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-3"
          tabType="ssh"
          sshSessionId="ssh-3"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => {
      expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith(
        expect.stringContaining('connect ECONNREFUSED 127.0.0.1:22'),
      );
    });
    expect(document.querySelector('[data-testid="ssh-terminal-notice"]')).toBeNull();
  });

  it('opens SSH shells with terminal-app friendly minimum dimensions', async () => {
    const { default: TerminalPane } = await loadTerminalPane();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-4"
          tabType="ssh"
          sshSessionId="ssh-4"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    expect(sshCreateShell).toHaveBeenCalledWith(expect.objectContaining({
      cols: 120,
      rows: 40,
    }));
  });

  it('registers the renderer data listener before opening the SSH shell', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    sshCreateShellImpl = () => {
      expect(terminalDataHandler).toBeTruthy();
      terminalDataHandler!({ id: 'term-ssh-early-data', data: '\x1b[6n' });
      return Promise.resolve({ connected: true });
    };

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-early-data"
          tabType="ssh"
          sshSessionId="ssh-early-data"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith('\x1b[6n');
  });
});
