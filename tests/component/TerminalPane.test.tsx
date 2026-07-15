import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { KeybindingsProvider } from '../../src/renderer/KeybindingsContext';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';
import { fileUrlToPath } from '../../src/renderer/osc7';
import { requestTerminalSearch } from '../../src/renderer/terminalSearch';

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
  static instances: MockAddonSearch[] = [];
  private resultsListener: ((results: { resultIndex: number; resultCount: number }) => void) | null = null;

  constructor() {
    MockAddonSearch.instances.push(this);
  }

  onDidChangeResults = vi.fn((listener: (results: { resultIndex: number; resultCount: number }) => void) => {
    this.resultsListener = listener;
    return { dispose: vi.fn(() => { this.resultsListener = null; }) };
  });
  findNext = vi.fn();
  findPrevious = vi.fn();
  clearDecorations = vi.fn();

  emitResults(results: { resultIndex: number; resultCount: number }) {
    this.resultsListener?.(results);
  }
}

class MockUnicode11Addon {}

class MockTerminal {
  static instances: MockTerminal[] = [];

  options: Record<string, unknown> = {};
  element: HTMLElement | undefined;
  oscHandlers = new Map<number, (data: string) => boolean | Promise<boolean>>();
  parser = {
    registerOscHandler: vi.fn((ident: number, handler: (data: string) => boolean | Promise<boolean>) => {
      this.oscHandlers.set(ident, handler);
      return { dispose: vi.fn(() => this.oscHandlers.delete(ident)) };
    }),
  };
  unicode = { activeVersion: '6' };
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  onBinary = vi.fn(() => ({ dispose: vi.fn() }));
  onKey = vi.fn(() => ({ dispose: vi.fn() }));
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  attachCustomKeyEventHandler = vi.fn();
  write = vi.fn();
  refresh = vi.fn();
  clearSelection = vi.fn();
  rows = 24;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    MockTerminal.instances.push(this);
  }
}

const terminalCreate = vi.fn(() => Promise.resolve({ pid: 123 }));
const terminalResize = vi.fn(() => Promise.resolve());
const terminalWrite = vi.fn(() => Promise.resolve());
const terminalWriteBinary = vi.fn(() => Promise.resolve());
const terminalDestroy = vi.fn(() => Promise.resolve());
const openExternal = vi.fn(() => Promise.resolve(true));
let sshCreateShellImpl: () => Promise<unknown> = () => Promise.resolve({ connected: true });
const sshCreateShell = vi.fn(() => sshCreateShellImpl());
const sshResizeShell = vi.fn(() => Promise.resolve());
const sshWriteShell = vi.fn(() => Promise.resolve());
const sshWriteShellBinary = vi.fn(() => Promise.resolve());
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

class MockWebLinksAddon {
  static handlers: Array<(event: MouseEvent, url: string) => void> = [];
  constructor(handler?: (event: MouseEvent, url: string) => void) {
    if (handler) MockWebLinksAddon.handlers.push(handler);
  }
}

vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: MockWebLinksAddon }));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: MockAddonSearch,
}));

let searchOverlayProps: any = null;
vi.mock('../../src/renderer/components/SearchOverlay', () => ({
  default: (props: unknown) => {
    searchOverlayProps = props;
    return null;
  },
}));

vi.mock('../../src/renderer/osc7', () => ({
  fileUrlToPath: vi.fn(() => null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  MockTerminal.instances = [];
  MockWebLinksAddon.handlers = [];
  MockAddonFit.instances = [];
  MockAddonSearch.instances = [];
  MockResizeObserver.instances = [];
  searchOverlayProps = null;
  MockTerminal.prototype.open = vi.fn(function open(this: MockTerminal, parent: HTMLElement) {
    if (!this.element) this.element = document.createElement('div');
    this.element.dataset.testid = 'xterm-dom';
    parent.appendChild(this.element);
  });
  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);
  sshCreateShellImpl = () => Promise.resolve({ connected: true });
  terminalDataHandler = null;
  vi.mocked(fileUrlToPath).mockReturnValue(null);
  Object.defineProperty(window, 'janet', {
    configurable: true,
    value: {
      terminalCreate,
      terminalResize,
      terminalWrite,
      terminalWriteBinary,
      terminalDestroy,
      onTerminalData,
      sshCreateShell,
      sshResizeShell,
      sshWriteShell,
      sshWriteShellBinary,
      openExternal,
    },
  });
});

async function loadTerminalPane() {
  return import('../../src/renderer/components/TerminalPane');
}

describe('TerminalPane SSH reinitialization', () => {
  it('passes local startup commands to backend creation without typing them from the renderer', async () => {
    const { default: TerminalPane } = await loadTerminalPane();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-startup-local"
          tabType="local"
          initialCwd="/repo"
          startupCommands={['npm install', 'npm run dev']}
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(terminalCreate).toHaveBeenCalledWith({
      id: 'term-startup-local',
      cwd: '/repo',
      startupCommands: ['npm install', 'npm run dev'],
    });
    expect(terminalWrite).not.toHaveBeenCalled();
  });

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
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'posix' as const,
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
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'posix',
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

  it('enables result tracking and fully clears terminal search state', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-search" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const searchAddon = MockAddonSearch.instances.at(-1)!;
    const term = MockTerminal.instances.at(-1)!;
    act(() => searchOverlayProps.onQueryChange('needle'));

    expect(searchAddon.findNext).toHaveBeenCalledWith('needle', {
      decorations: {
        matchBorder: '#7aa2f7',
        matchOverviewRuler: '#7aa2f7',
        activeMatchBorder: '#e0af68',
        activeMatchColorOverviewRuler: '#e0af68',
      },
    });

    act(() => searchAddon.emitResults({ resultIndex: 1, resultCount: 3 }));
    expect(searchOverlayProps.results).toEqual({ resultIndex: 1, resultCount: 3 });

    act(() => searchOverlayProps.onQueryChange(''));
    expect(searchAddon.clearDecorations).toHaveBeenCalled();
    expect(term.clearSelection).toHaveBeenCalled();
  });

  it('opens search only for the requested terminal pane', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-command-search"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(searchOverlayProps.visible).toBe(false);

    act(() => requestTerminalSearch('another-terminal'));
    expect(searchOverlayProps.visible).toBe(false);

    act(() => requestTerminalSearch('term-command-search'));
    expect(searchOverlayProps.visible).toBe(true);
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

  it('refits and synchronizes backend dimensions after a font-size change', async () => {
    vi.useFakeTimers();
    try {
      const { default: TerminalPane } = await loadTerminalPane();
      const view = render(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-font-resize"
            tabType="local"
            onReady={vi.fn()}
            onRemoved={vi.fn()}
            themeName="tokyo-night"
            fontSize={14}
          />
        </KeybindingsProvider>,
      );

      await vi.runAllTimersAsync();
      const term = MockTerminal.instances[0];
      const fit = MockAddonFit.instances[0];
      terminalResize.mockClear();
      fit.fit.mockClear();
      fit.proposeDimensions.mockReturnValue({ cols: 91, rows: 28 });

      view.rerender(
        <KeybindingsProvider>
          <TerminalPane
            termId="term-font-resize"
            tabType="local"
            onReady={vi.fn()}
            onRemoved={vi.fn()}
            themeName="tokyo-night"
            fontSize={18}
          />
        </KeybindingsProvider>,
      );
      await vi.advanceTimersByTimeAsync(10);

      expect(term.options.fontSize).toBe(18);
      expect(fit.fit).toHaveBeenCalled();
      expect(terminalResize).toHaveBeenCalledWith({ id: 'term-font-resize', cols: 91, rows: 28 });
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
          startupCommands={['codex update']}
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(1);
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(terminalCreate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'term-reused',
      startupCommands: ['codex update'],
    }));
    expect(MockTerminal.instances[0].dispose).not.toHaveBeenCalled();

    const searchAddon = MockAddonSearch.instances[0];
    act(() => searchOverlayProps.onQueryChange('needle'));
    searchAddon.clearDecorations.mockClear();
    MockTerminal.instances[0].clearSelection.mockClear();

    unmount();

    expect(onRemoved).toHaveBeenCalledWith('term-reused');
    expect(MockTerminal.instances[0].dispose).not.toHaveBeenCalled();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-reused"
          tabType="local"
          startupCommands={['codex update']}
          hasSession
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(1);
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(searchAddon.clearDecorations).toHaveBeenCalledTimes(1);
    expect(MockTerminal.instances[0].clearSelection).toHaveBeenCalledTimes(1);
    const activeKeyHandler = MockTerminal.instances[0].attachCustomKeyEventHandler.mock.calls.at(-1)?.[0];
    const preventDefault = vi.fn();
    act(() => activeKeyHandler({
      key: 'f',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault,
    }));
    expect(preventDefault).toHaveBeenCalled();
    expect(searchOverlayProps.visible).toBe(true);
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
  it('invalidates live workspace data on every valid local shell prompt', async () => {
    vi.mocked(fileUrlToPath).mockReturnValue('/repo');
    const invalidate = vi.spyOn(refreshCoordinator, 'invalidate');
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-prompt" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const handler = MockTerminal.instances.at(-1)?.oscHandlers.get(7)!;
    await handler('file://localhost/repo');
    await handler('file://localhost/repo');

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith('prompt');
  });

  it('opens terminal links through the default-browser bridge instead of a renderer window', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-links" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const event = { preventDefault: vi.fn() } as unknown as MouseEvent;
    MockWebLinksAddon.handlers[0](event, 'https://example.com/docs');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.janet.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('does not allow remote OSC 7 output to change the local cwd', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onCwdChange = vi.fn();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-cwd"
          tabType="ssh"
          sshSessionId="ssh-cwd"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onCwdChange={onCwdChange}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    const handler = MockTerminal.instances.at(-1)?.oscHandlers.get(7);
    expect(handler).toBeUndefined();
    expect(onCwdChange).not.toHaveBeenCalled();
  });

  it('forwards binary local terminal input without UTF-8 conversion', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-binary" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const terminal = MockTerminal.instances.at(-1)!;
    const keyHandler = (terminal.onKey as any).mock.calls[0][0] as () => void;
    const binaryHandler = (terminal.onBinary as any).mock.calls[0][0] as (data: string) => void;
    keyHandler();
    binaryHandler('\xff\x00');

    expect(terminalWriteBinary).toHaveBeenCalledWith({
      id: 'term-binary', data: '\xff\x00', userInput: true,
    });
  });

  it('distinguishes user keystrokes from automatic terminal replies', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-input-source" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const terminal = MockTerminal.instances.at(-1)!;
    const dataHandler = (terminal.onData as any).mock.calls[0][0] as (data: string) => void;
    const keyHandler = (terminal.onKey as any).mock.calls[0][0] as () => void;

    dataHandler('\x1b[1;1R');
    keyHandler();
    dataHandler('l');

    expect(terminalWrite).toHaveBeenNthCalledWith(1, {
      id: 'term-input-source', data: '\x1b[1;1R', userInput: false,
    });
    expect(terminalWrite).toHaveBeenNthCalledWith(2, {
      id: 'term-input-source', data: 'l', userInput: true,
    });
  });

  it('keeps the waiting SSH notice visible until remote output arrives', async () => {
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

    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');
    expect(screen.getByText('Connected to box. Waiting for first output.')).toBeInTheDocument();

    await act(async () => resolveShell({ connected: true }));
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');

    act(() => terminalDataHandler!({ id: 'term-ssh', data: 'prompt' }));
    expect(screen.queryByTestId('ssh-terminal-notice')).toBeNull();
  });

  it('writes remote SSH output directly into xterm and clears the waiting notice', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    sshCreateShellImpl = () => new Promise(() => {});

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
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');
    act(() => terminalDataHandler!({ id: 'term-ssh-2', data: 'terminal.shop output' }));

    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith('terminal.shop output');
    expect(screen.queryByTestId('ssh-terminal-notice')).toBeNull();
  });

  it('shows shell-open failures with a working retry action and keeps the xterm transcript', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    let resolveRetry: () => void = () => {};
    const onSshRetry = vi.fn(() => new Promise<void>((resolve) => { resolveRetry = resolve; }));
    sshCreateShellImpl = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:22'));

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-3"
          tabType="ssh"
          sshSessionId="ssh-3"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onSshRetry={onSshRetry}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => {
      expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith(
        expect.stringContaining('connect ECONNREFUSED 127.0.0.1:22'),
      );
    });
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('connect ECONNREFUSED 127.0.0.1:22')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ssh-notice-retry'));

    expect(onSshRetry).toHaveBeenCalledWith('term-ssh-3', { cols: 120, rows: 40 });
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');

    await act(async () => resolveRetry());
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');

    act(() => terminalDataHandler!({ id: 'term-ssh-3', data: 'ready' }));
    expect(screen.queryByTestId('ssh-terminal-notice')).toBeNull();
  });

  it('preserves a failed SSH notice when a cached terminal is remounted', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    sshCreateShellImpl = () => Promise.reject(new Error('Remote shell unavailable'));
    const props = {
      termId: 'term-ssh-remount-error',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-remount-error',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshRetry: vi.fn(() => Promise.resolve()),
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Remote shell unavailable');
    first.unmount();

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Remote shell unavailable');
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
    expect(sshCreateShell).toHaveBeenCalledTimes(1);
  });

  it('does not restore a stale waiting notice after cached output arrives offscreen', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    sshCreateShellImpl = () => new Promise(() => {});
    const props = {
      termId: 'term-ssh-remount-output',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-remount-output',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');
    first.unmount();

    act(() => terminalDataHandler!({ id: props.termId, data: 'prompt while hidden' }));
    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );

    expect(screen.queryByTestId('ssh-terminal-notice')).toBeNull();
    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith('prompt while hidden');
  });

  it('publishes an offscreen retry failure to the remounted cached pane', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    let rejectRetry: (error: Error) => void = () => {};
    const onSshRetry = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectRetry = reject;
    }));
    sshCreateShellImpl = () => Promise.reject(new Error('Initial shell failure'));
    const props = {
      termId: 'term-ssh-remount-retry',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-remount-retry',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshRetry,
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');
    first.unmount();

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');

    await act(async () => rejectRetry(new Error('Transport reconnect failed')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Transport reconnect failed');
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
  });

  it('shows reconnecting while a restored SSH transport is not ready', async () => {
    const { default: TerminalPane } = await loadTerminalPane();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-pending"
          tabType="ssh"
          sshSessionId="ssh-pending"
          sshShellReady={false}
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');
    expect(sshCreateShell).not.toHaveBeenCalled();
  });

  it('shows a reconnect action when an established SSH transport closes', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onSshRetry = vi.fn(() => Promise.resolve());
    const props = {
      termId: 'term-ssh-disconnected',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-disconnected',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshRetry,
      themeName: 'tokyo-night',
    };

    const view = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));

    view.rerender(
      <KeybindingsProvider>
        <TerminalPane {...props} sshConnectionLost />
      </KeybindingsProvider>,
    );

    expect(await screen.findByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'closed');
    expect(screen.getByText('Connection closed')).toBeInTheDocument();
    expect(screen.getByTestId('ssh-notice-retry')).toBeInTheDocument();
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
