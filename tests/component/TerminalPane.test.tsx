import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { KeybindingsProvider } from '../../src/renderer/KeybindingsContext';
import { refreshCoordinator } from '../../src/renderer/refreshCoordinator';
import { fileUrlToPath } from '../../src/renderer/osc7';
import { requestTerminalSearch } from '../../src/renderer/terminalSearch';
import type { AgentLifecycleEvent } from '../../src/renderer/terminalAwareness';
import {
  beginTerminalPathDrag,
  endTerminalPathDrag,
  TERMINAL_PATH_MIME,
  type TerminalPathDragPayload,
} from '../../src/renderer/terminalPathDrag';

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
  proposeDimensions = vi.fn((): { cols: number; rows: number } | undefined => ({ cols: 80, rows: 24 }));
  fit = vi.fn();

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
  static nativePasteData: string | null = null;

  options: Record<string, unknown> = {};
  element: HTMLElement | undefined;
  textarea = document.createElement('textarea');
  oscHandlers = new Map<number, (data: string) => boolean | Promise<boolean>>();
  parser = {
    registerOscHandler: vi.fn((ident: number, handler: (data: string) => boolean | Promise<boolean>) => {
      this.oscHandlers.set(ident, handler);
      return { dispose: vi.fn(() => this.oscHandlers.delete(ident)) };
    }),
  };
  unicode = { activeVersion: '6' };
  dataHandler: ((data: string) => void) | null = null;
  binaryHandler: ((data: string) => void) | null = null;
  onData = vi.fn((handler: (data: string) => void) => {
    this.dataHandler = handler;
    return {
      dispose: vi.fn(() => {
        if (this.dataHandler === handler) this.dataHandler = null;
      }),
    };
  });
  onBinary = vi.fn((handler: (data: string) => void) => {
    this.binaryHandler = handler;
    return { dispose: vi.fn(() => { if (this.binaryHandler === handler) this.binaryHandler = null; }) };
  });
  onKey = vi.fn(() => ({ dispose: vi.fn() }));
  loadAddon = vi.fn((addon: { activate?: (terminal: MockTerminal) => void }) => addon.activate?.(this));
  open = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  resize = vi.fn((cols: number, rows: number) => {
    this.cols = cols;
    this.rows = rows;
  });
  attachCustomKeyEventHandler = vi.fn();
  writeCallbacks: Array<() => void> = [];
  write = vi.fn((_data: string, callback?: () => void) => {
    if (callback) this.writeCallbacks.push(callback);
  });
  paste = vi.fn((data: string) => this.dataHandler?.(data));
  refresh = vi.fn();
  clearSelection = vi.fn();
  selection = '';
  hasSelection = vi.fn(() => Boolean(this.selection));
  getSelection = vi.fn(() => this.selection);
  bufferLines = ['$ one', '$ two'];
  wrappedLines = new Set<number>();
  markerLine = 0;
  buffer = {
    active: {
      type: 'normal',
      baseY: 0,
      cursorY: 0,
      cursorX: 0,
      viewportY: 0,
      getLine: (line: number) => this.bufferLines[line] === undefined
        ? undefined
        : {
            isWrapped: this.wrappedLines.has(line),
            translateToString: (trimRight?: boolean, start = 0, end?: number) => {
              const value = this.bufferLines[line].slice(start, end);
              return trimRight ? value.trimEnd() : value;
            },
          },
    },
  };
  registerMarker = vi.fn(() => ({ line: this.markerLine, isDisposed: false, dispose: vi.fn() }));
  registerDecoration = vi.fn(() => ({ dispose: vi.fn(), onRender: vi.fn() }));
  scrollToLine = vi.fn();
  scrollToBottom = vi.fn();
  rows = 24;
  cols = 80;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    this.textarea.addEventListener('paste', () => {
      if (MockTerminal.nativePasteData !== null) this.dataHandler?.(MockTerminal.nativePasteData);
    });
    MockTerminal.instances.push(this);
  }
}

const terminalCreate = vi.fn(() => Promise.resolve({ pid: 123 }));
const terminalResize = vi.fn(() => Promise.resolve());
const terminalWrite = vi.fn(() => Promise.resolve());
const terminalWriteBinary = vi.fn(() => Promise.resolve());
const terminalDestroy = vi.fn(() => Promise.resolve());
const terminalAcknowledgeOutput = vi.fn(() => Promise.resolve());
const openExternal = vi.fn(() => Promise.resolve(true));
const copyTerminalText = vi.fn(() => true);
let sshCreateShellImpl: () => Promise<unknown> = () => Promise.resolve({ connected: true });
const sshCreateShell = vi.fn(() => sshCreateShellImpl());
const sshResizeShell = vi.fn(() => Promise.resolve());
const sshWriteShell = vi.fn(() => Promise.resolve());
const sshWriteShellBinary = vi.fn(() => Promise.resolve());
type TestTerminalOutput = {
  source: 'local' | 'ssh';
  id: string;
  data: string;
  generation: number;
  sequence: number;
};
let terminalDataHandler: ((params: TestTerminalOutput) => void) | null = null;
const onTerminalData = vi.fn((cb: (params: TestTerminalOutput) => void) => {
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
  MockTerminal.nativePasteData = null;
  MockWebLinksAddon.handlers = [];
  MockAddonFit.instances = [];
  MockAddonSearch.instances = [];
  MockResizeObserver.instances = [];
  searchOverlayProps = null;
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => true),
  });
  MockTerminal.prototype.open = vi.fn(function open(this: MockTerminal, parent: HTMLElement) {
    if (!this.element) this.element = document.createElement('div');
    this.element.dataset.testid = 'xterm-dom';
    parent.appendChild(this.element);
  });
  vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);
  endTerminalPathDrag();
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
      terminalAcknowledgeOutput,
      onTerminalData,
      sshCreateShell,
      sshResizeShell,
      sshWriteShell,
      sshWriteShellBinary,
      openExternal,
      copyTerminalText,
    },
  });
});

function dataTransferWithPayload(payload: TerminalPathDragPayload): DataTransfer {
  const values = new Map<string, string>();
  const transfer = {
    dropEffect: 'none',
    effectAllowed: 'all',
    get types() { return Array.from(values.keys()); },
    setData: (type: string, value: string) => { values.set(type, value); },
    getData: (type: string) => values.get(type) ?? '',
  } as unknown as DataTransfer;
  beginTerminalPathDrag(transfer, payload);
  return transfer;
}

function dataTransferWithText(value: string): DataTransfer {
  const values = new Map<string, string>([['text/plain', value]]);
  return {
    dropEffect: 'none',
    effectAllowed: 'all',
    get types() { return Array.from(values.keys()); },
    setData: (type: string, data: string) => { values.set(type, data); },
    getData: (type: string) => values.get(type) ?? '',
  } as unknown as DataTransfer;
}

async function loadTerminalPane() {
  return import('../../src/renderer/components/TerminalPane');
}

describe('TerminalPane SSH reinitialization', () => {
  it("uses the pane label for xterm's helper input", async () => {
    const { default: TerminalPane } = await loadTerminalPane();

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-named-input"
          tabType="local"
          inputLabel="Tests — Local terminal pane"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances[0].textarea).toHaveAttribute(
      'aria-label',
      'Tests — Local terminal pane',
    );
  });

  it('updates the helper input name without recreating xterm', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const props = {
      termId: 'term-renamed-input',
      tabType: 'local' as const,
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };
    const { rerender } = render(
      <KeybindingsProvider>
        <TerminalPane {...props} inputLabel="Logs — Local terminal pane" />
      </KeybindingsProvider>,
    );
    const term = MockTerminal.instances[0];

    rerender(
      <KeybindingsProvider>
        <TerminalPane {...props} inputLabel="Tests — Local terminal pane" />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(1);
    expect(term.dispose).not.toHaveBeenCalled();
    expect(term.textarea).toHaveAttribute('aria-label', 'Tests — Local terminal pane');
  });

  it('refreshes the helper input name when a cached xterm reattaches', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const props = {
      termId: 'term-remounted-input',
      tabType: 'local' as const,
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };
    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} inputLabel="Old — Local terminal pane" />
      </KeybindingsProvider>,
    );
    const term = MockTerminal.instances[0];
    first.unmount();

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} inputLabel="Current — Local terminal pane" hasSession />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(1);
    expect(term.dispose).not.toHaveBeenCalled();
    expect(term.textarea).toHaveAttribute('aria-label', 'Current — Local terminal pane');
  });

  it('does not reuse the input name from a disposed same-ID terminal', async () => {
    const { default: TerminalPane, disposeCachedTerminal } = await loadTerminalPane();
    const props = {
      termId: 'term-replaced-input',
      tabType: 'local' as const,
      hasSession: true,
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };
    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} inputLabel="Old — Local terminal pane" />
      </KeybindingsProvider>,
    );
    const oldTerm = MockTerminal.instances[0];
    first.unmount();
    disposeCachedTerminal(props.termId);

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} inputLabel="New — Local terminal pane" />
      </KeybindingsProvider>,
    );

    expect(MockTerminal.instances).toHaveLength(2);
    expect(oldTerm.textarea).toHaveAttribute('aria-label', 'Old — Local terminal pane');
    expect(MockTerminal.instances[1].textarea).toHaveAttribute('aria-label', 'New — Local terminal pane');
  });

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

  it('keeps a failed local terminal recoverable across a cached remount', async () => {
    terminalCreate.mockRejectedValueOnce(new Error('File not found'));
    const { default: TerminalPane } = await loadTerminalPane();
    const onReady = vi.fn();
    const onRemoved = vi.fn();
    const props = {
      termId: 'term-local-spawn-failed',
      tabType: 'local' as const,
      initialCwd: '/repo',
      startupCommands: ['npm run dev'],
      onReady,
      onRemoved,
      themeName: 'tokyo-night',
    };
    const request = {
      id: props.termId,
      cwd: props.initialCwd,
      startupCommands: props.startupCommands,
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('File not found');
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(terminalCreate).toHaveBeenNthCalledWith(1, request);
    expect(onReady).not.toHaveBeenCalled();
    first.unmount();

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} initialCwd="/resolved-home" />
      </KeybindingsProvider>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t start local terminal');
    expect(alert).toHaveTextContent('File not found');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry.tabIndex).toBe(0);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    fireEvent.click(retry);

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    expect(onReady).toHaveBeenCalledWith(props.termId);
    expect(terminalCreate).toHaveBeenCalledTimes(2);
    expect(terminalCreate).toHaveBeenNthCalledWith(2, request);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores a local retry that completes after its cached terminal is replaced', async () => {
    let resolveRetry!: (value: { pid: number }) => void;
    terminalCreate
      .mockRejectedValueOnce(new Error('File not found'))
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));
    const { default: TerminalPane, disposeCachedTerminal } = await loadTerminalPane();
    const oldReady = vi.fn();
    const replacementReady = vi.fn();
    const props = {
      termId: 'term-local-retry-replaced',
      tabType: 'local' as const,
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} onReady={oldReady} />
      </KeybindingsProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(terminalCreate).toHaveBeenCalledTimes(2);

    first.unmount();
    expect(disposeCachedTerminal(props.termId)).toBe(true);
    render(
      <KeybindingsProvider>
        <TerminalPane {...props} onReady={replacementReady} />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(replacementReady).toHaveBeenCalledTimes(1));
    expect(MockTerminal.instances).toHaveLength(2);

    await act(async () => resolveRetry({ pid: 456 }));

    expect(oldReady).not.toHaveBeenCalled();
    expect(replacementReady).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not ready a local terminal whose creation resolves after removal', async () => {
    let resolveCreate!: (value: { pid: number }) => void;
    terminalCreate.mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
    const { default: TerminalPane } = await loadTerminalPane();
    const onReady = vi.fn();
    const onRemoved = vi.fn();

    const view = render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-removed-before-create"
          tabType="local"
          onReady={onReady}
          onRemoved={onRemoved}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    view.unmount();
    expect(onRemoved).toHaveBeenCalledWith('term-removed-before-create');
    await act(async () => resolveCreate({ pid: 123 }));
    expect(onReady).not.toHaveBeenCalled();
  });

  it('readies a local terminal whose creation resolves after a cached remount', async () => {
    let resolveCreate!: (value: { pid: number }) => void;
    terminalCreate.mockReturnValueOnce(new Promise((resolve) => { resolveCreate = resolve; }));
    const { default: TerminalPane } = await loadTerminalPane();
    const oldReady = vi.fn();
    const currentReady = vi.fn();
    const props = {
      termId: 'term-remounted-before-create',
      tabType: 'local' as const,
      onRemoved: vi.fn(),
      themeName: 'tokyo-night',
    };

    const view = render(
      <KeybindingsProvider>
        <TerminalPane {...props} initialCwd="/repo" onReady={oldReady} />
      </KeybindingsProvider>,
    );

    view.rerender(
      <KeybindingsProvider>
        <TerminalPane {...props} initialCwd="/resolved-home" onReady={currentReady} />
      </KeybindingsProvider>,
    );
    expect(terminalCreate).toHaveBeenCalledTimes(1);
    expect(MockTerminal.instances).toHaveLength(1);

    await act(async () => resolveCreate({ pid: 123 }));

    expect(oldReady).not.toHaveBeenCalled();
    expect(currentReady).toHaveBeenCalledTimes(1);
    expect(currentReady).toHaveBeenCalledWith(props.termId);
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

  it('consumes only JaneT agent OSC 777 events and binds them to this terminal', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onAgentEvent = vi.fn();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-agent"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onAgentEvent={onAgentEvent}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    const handler = MockTerminal.instances[0].oscHandlers.get(777)!;
    const event: Omit<AgentLifecycleEvent, 'provider'> = {
      version: 1,
      event: 'turn.start',
      sessionId: 'session-1',
      turnId: 'turn-1',
    };
    const encoded = Buffer.from(JSON.stringify(event)).toString('base64url');

    expect(await handler(`janet-agent;hermes;${encoded}`)).toBe(true);
    expect(onAgentEvent).toHaveBeenCalledWith('term-agent', {
      provider: 'hermes',
      ...event,
    });

    expect(await handler('janet-agent;hermes;%%%')).toBe(true);
    expect(onAgentEvent).toHaveBeenCalledOnce();
    expect(await handler('notify;Build finished')).toBe(false);
    expect(onAgentEvent).toHaveBeenCalledOnce();
  });

  it('marks the shell ready only after startup and prompt markers in either order', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const view = render(
      <KeybindingsProvider>
        <TerminalPane termId="term-ready" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    let term = MockTerminal.instances[0];
    expect(await term.oscHandlers.get(777)!('janet-ready')).toBe(true);
    expect(term.textarea).not.toHaveAttribute('data-shell-ready');
    expect(await term.oscHandlers.get(133)!('A')).toBe(true);
    expect(await term.oscHandlers.get(133)!('B')).toBe(true);
    expect(term.textarea).toHaveAttribute('data-shell-ready', 'true');

    view.unmount();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-ready-reversed" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );
    term = MockTerminal.instances.at(-1)!;
    expect(await term.oscHandlers.get(133)!('A')).toBe(true);
    expect(await term.oscHandlers.get(133)!('B')).toBe(true);
    expect(term.textarea).not.toHaveAttribute('data-shell-ready');
    expect(await term.oscHandlers.get(777)!('janet-ready')).toBe(true);
    expect(term.textarea).toHaveAttribute('data-shell-ready', 'true');
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

  it('writes selected terminal text synchronously before the next paste', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-copy" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const term = MockTerminal.instances.at(-1)!;
    term.selection = 'first line\nsecond line';
    const keyHandler = term.attachCustomKeyEventHandler.mock.calls.at(-1)?.[0];

    for (const modifiers of [
      { ctrlKey: true, metaKey: false, shiftKey: false },
      { ctrlKey: true, metaKey: false, shiftKey: true },
      { ctrlKey: false, metaKey: true, shiftKey: false },
    ]) {
      const preventDefault = vi.fn();
      expect(keyHandler({
        type: 'keydown', key: 'c', altKey: false, ...modifiers, preventDefault,
      })).toBe(false);
      expect(preventDefault).toHaveBeenCalledOnce();
    }
    expect(keyHandler({
      type: 'keyup', key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(),
    })).toBe(true);
    fireEvent.contextMenu(document.querySelector('.terminal-container')!);

    expect(copyTerminalText).toHaveBeenCalledTimes(4);
    expect(copyTerminalText).toHaveBeenCalledWith('first line\nsecond line');
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(terminalWrite).not.toHaveBeenCalledWith(expect.objectContaining({ data: '\u0003' }));
  });

  it('keeps unselected Ctrl+C available for terminal interrupt', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-interrupt" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const term = MockTerminal.instances.at(-1)!;
    const keyHandler = term.attachCustomKeyEventHandler.mock.calls.at(-1)?.[0];
    for (const modifiers of [
      { ctrlKey: true, metaKey: false, shiftKey: false },
      { ctrlKey: true, metaKey: false, shiftKey: true },
      { ctrlKey: false, metaKey: true, shiftKey: false },
    ]) {
      expect(keyHandler({
        type: 'keydown', key: 'c', altKey: false, ...modifiers, preventDefault: vi.fn(),
      })).toBe(true);
    }
  });

  it('handles semantic command navigation and safe copy shortcuts without shell input', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-commands" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );
    const term = MockTerminal.instances.at(-1)!;
    const osc = term.oscHandlers.get(133)!;
    const keyHandler = term.attachCustomKeyEventHandler.mock.calls.at(-1)?.[0];
    for (const line of [0, 1]) {
      term.markerLine = line;
      term.buffer.active.cursorY = line;
      term.buffer.active.cursorX = 2;
      await osc('A'); await osc('B');
      term.buffer.active.cursorX = 5;
      await osc('C'); await osc('D;0');
    }
    term.buffer.active.viewportY = 2;

    const event = (key: string) => ({
      type: 'keydown', key, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false,
      preventDefault: vi.fn(),
    });
    expect(keyHandler(event('ArrowUp'))).toBe(false);
    expect(term.scrollToLine).toHaveBeenLastCalledWith(1);
    const copyEvent = (key: string) => ({
      type: 'keydown', key, ctrlKey: true, shiftKey: false, altKey: true, metaKey: false,
      preventDefault: vi.fn(),
    });
    expect(keyHandler(copyEvent('c'))).toBe(false);
    expect(copyTerminalText).toHaveBeenLastCalledWith('two');
    expect(keyHandler(copyEvent('o'))).toBe(true);
    expect(terminalWrite).not.toHaveBeenCalled();
  });

  it('pastes the current semantic command for rerun without submitting it', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-rerun" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );
    const term = MockTerminal.instances.at(-1)!;
    const osc = term.oscHandlers.get(133)!;
    term.buffer.active.cursorX = 2; await osc('A'); await osc('B');
    term.buffer.active.cursorX = 5; await osc('C'); await osc('D;0');
    term.buffer.active.viewportY = 1;
    const keyHandler = term.attachCustomKeyEventHandler.mock.calls.at(-1)?.[0];
    keyHandler({ type: 'keydown', key: 'ArrowUp', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, preventDefault: vi.fn() });

    expect(keyHandler({ type: 'keydown', key: 'r', ctrlKey: true, shiftKey: false, altKey: true, metaKey: false, preventDefault: vi.fn() })).toBe(false);
    expect(term.paste).toHaveBeenCalledOnce();
    expect(term.paste).toHaveBeenCalledWith('one');
  });

  it('delivers semantic completions only to the current cached-pane listener', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const props = { termId: 'term-semantic-remount', tabType: 'local' as const, onReady: vi.fn(), onRemoved: vi.fn(), themeName: 'tokyo-night' };
    const first = render(<KeybindingsProvider><TerminalPane {...props} onSemanticCommand={firstListener} /></KeybindingsProvider>);
    const term = MockTerminal.instances.at(-1)!;
    const osc = term.oscHandlers.get(133)!;
    first.unmount();
    render(<KeybindingsProvider><TerminalPane {...props} onSemanticCommand={secondListener} /></KeybindingsProvider>);

    term.buffer.active.cursorX = 2; await osc('A'); await osc('B');
    term.buffer.active.cursorX = 5; await osc('C'); await osc('D;0');

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledOnce();
    expect(secondListener).toHaveBeenCalledWith('term-semantic-remount', expect.objectContaining({ command: 'one' }));
  });

  it('delivers semantic completion while its cached pane is detached', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const started = vi.fn();
    const completed = vi.fn();
    const pane = render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-semantic-detached"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onSemanticCommandStarted={started}
          onSemanticCommand={completed}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );
    const term = MockTerminal.instances.at(-1)!;
    const osc = term.oscHandlers.get(133)!;
    term.buffer.active.cursorX = 2; await osc('A'); await osc('B');
    term.buffer.active.cursorX = 5; await osc('C');
    expect(started).toHaveBeenCalledOnce();

    pane.unmount();
    await osc('D;0');

    expect(completed).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith(
      'term-semantic-detached', expect.objectContaining({ command: 'one', exitCode: 0 }),
    );
  });

  it('pastes a requested snippet into only its target terminal without adding Enter', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-snippet" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const term = MockTerminal.instances.at(-1)!;
    const text = 'docker compose logs -f';
    act(() => window.dispatchEvent(new CustomEvent('janet:terminal-paste-request', {
      detail: { termId: 'term-snippet', text },
    })));

    expect(term.paste).toHaveBeenCalledWith(text);
    expect(terminalWrite).toHaveBeenCalledWith({ id: 'term-snippet', data: text, userInput: true });
    expect(term.paste).not.toHaveBeenCalledWith(`${text}\n`);
  });

  it('pastes a requested snippet into the active SSH shell without adding Enter', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-snippet-ssh"
          tabType="ssh"
          sshSessionId="ssh-snippet"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(sshCreateShell).toHaveBeenCalled());
    const term = MockTerminal.instances.at(-1)!;
    const text = 'sudo systemctl restart app';
    act(() => window.dispatchEvent(new CustomEvent('janet:terminal-paste-request', {
      detail: { termId: 'term-snippet-ssh', text },
    })));

    expect(term.paste).toHaveBeenCalledWith(text);
    expect(sshWriteShell).toHaveBeenCalledWith({
      sessionId: 'ssh-snippet', termId: 'term-snippet-ssh', data: text, userInput: true,
    });
    expect(term.paste).not.toHaveBeenCalledWith(`${text}\n`);
  });

  it('acknowledges output only after xterm has parsed it', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-output"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(terminalDataHandler).not.toBeNull());
    const term = MockTerminal.instances[0];
    act(() => terminalDataHandler?.({
      source: 'ssh', id: 'term-output', data: 'stale SSH output', generation: 1, sequence: 16,
    }));
    expect(term.write).not.toHaveBeenCalledWith('stale SSH output', expect.any(Function));
    act(() => terminalDataHandler?.({
      source: 'local', id: 'term-output', data: 'large output', generation: 3, sequence: 7,
    }));

    expect(term.write).toHaveBeenCalledWith('large output', expect.any(Function));
    expect(terminalAcknowledgeOutput).not.toHaveBeenCalled();
    term.writeCallbacks.shift()?.();
    expect(terminalAcknowledgeOutput).toHaveBeenCalledWith({
      source: 'local', id: 'term-output', generation: 3, sequence: 7,
    });
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

      await vi.runAllTimersAsync();
      const term = MockTerminal.instances[0];
      const fit = MockAddonFit.instances[0];
      fit.proposeDimensions.mockReturnValue({ cols: 132, rows: 37 });
      fit.fit.mockImplementation(() => term.resize(132, 37));
      terminalResize.mockClear();
      fit.fit.mockClear();
      fit.proposeDimensions.mockClear();
      MockResizeObserver.instances[0].trigger();
      await vi.advanceTimersByTimeAsync(50);

      expect(fit.fit).toHaveBeenCalledOnce();
      expect(term.resize).toHaveBeenCalledWith(132, 37);
      expect(terminalResize).toHaveBeenCalledWith({ id: 'term-resize', cols: 132, rows: 37 });
      expect(term.refresh).toHaveBeenCalledWith(0, 36);

      terminalResize.mockClear();
      MockResizeObserver.instances[0].trigger();
      await vi.advanceTimersByTimeAsync(50);
      expect(terminalResize).not.toHaveBeenCalled();

      term.resize.mockClear();
      fit.proposeDimensions.mockClear();
      fit.proposeDimensions.mockReturnValue(undefined);
      MockResizeObserver.instances[0].trigger();
      await vi.advanceTimersByTimeAsync(50);
      expect(fit.proposeDimensions).toHaveBeenCalledOnce();
      expect(term.resize).not.toHaveBeenCalled();
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
      fit.fit.mockImplementation(() => term.resize(91, 28));

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

describe('TerminalPane', () => {
  it('offers marked user input to broadcast while automatic replies keep the normal path', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onBroadcastInput = vi.fn(() => true);
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-broadcast"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onBroadcastInput={onBroadcastInput}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );
    const terminal = MockTerminal.instances.at(-1)!;

    terminal.dataHandler?.('\u001b[0n');
    expect(onBroadcastInput).not.toHaveBeenCalled();
    expect(terminalWrite).toHaveBeenCalledWith({ id: 'term-broadcast', data: '\u001b[0n', userInput: false });

    const markUserInput = (terminal.onKey as any).mock.calls[0][0] as () => void;
    markUserInput();
    terminal.dataHandler?.('x');
    expect(onBroadcastInput).toHaveBeenCalledWith('term-broadcast', 'x');
    expect(terminalWrite).not.toHaveBeenCalledWith({ id: 'term-broadcast', data: 'x', userInput: true });
  });

  it('offers user paste and binary input to broadcast exactly once', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onBroadcastInput = vi.fn(() => true);
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-broadcast-binary"
          tabType="local"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onBroadcastInput={onBroadcastInput}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );
    const terminal = MockTerminal.instances.at(-1)!;

    MockTerminal.nativePasteData = 'pasted';
    fireEvent.paste(terminal.textarea);
    expect(onBroadcastInput).toHaveBeenCalledWith('term-broadcast-binary', 'pasted');

    fireEvent.input(terminal.textarea);
    terminal.binaryHandler?.('\u0000');
    expect(onBroadcastInput).toHaveBeenCalledWith('term-broadcast-binary', '\u0000', true);
    expect(onBroadcastInput).toHaveBeenCalledTimes(2);
    expect(terminalWrite).not.toHaveBeenCalled();
    expect(terminalWriteBinary).not.toHaveBeenCalled();
  });

  it('preserves broadcast handling through StrictMode effect replay from a cold cache', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const onBroadcastInput = vi.fn(() => true);
    const onRemoved = vi.fn();
    const onReady = vi.fn(() => {
      if (!onRemoved.mock.calls.length) return;
      const terminal = MockTerminal.instances.at(-1)!;
      const markUserInput = (terminal.onKey as any).mock.calls.at(-1)[0] as () => void;
      markUserInput();
      terminal.dataHandler?.('x');
      markUserInput();
      terminal.binaryHandler?.('\u0000');
    });
    render(
      <React.StrictMode>
        <KeybindingsProvider>
          <TerminalPane
            termId="term-broadcast-strict"
            tabType="ssh"
            sshSessionId="ssh-broadcast-strict"
            onReady={onReady}
            onRemoved={onRemoved}
            onBroadcastInput={onBroadcastInput}
            themeName="tokyo-night"
          />
        </KeybindingsProvider>
      </React.StrictMode>,
    );
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(onBroadcastInput).toHaveBeenCalledTimes(2);
    expect(onBroadcastInput).toHaveBeenNthCalledWith(1, 'term-broadcast-strict', 'x');
    expect(onBroadcastInput).toHaveBeenLastCalledWith('term-broadcast-strict', '\u0000', true);
    expect(sshWriteShell).not.toHaveBeenCalled();
    expect(sshWriteShellBinary).not.toHaveBeenCalled();
  });

  it('routes marked text and binary input to the current callback after a cached remount', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    const callbackA = vi.fn(() => true);
    const callbackB = vi.fn(() => true);
    const props = {
      termId: 'term-broadcast-remount', tabType: 'local' as const,
      onReady: vi.fn(), onRemoved: vi.fn(), themeName: 'tokyo-night',
    };
    const first = render(
      <KeybindingsProvider><TerminalPane {...props} onBroadcastInput={callbackA} /></KeybindingsProvider>,
    );
    const terminal = MockTerminal.instances.at(-1)!;

    first.unmount();
    render(<KeybindingsProvider><TerminalPane {...props} onBroadcastInput={callbackB} /></KeybindingsProvider>);

    const markUserInput = (terminal.onKey as any).mock.calls.at(-1)[0] as () => void;
    markUserInput();
    terminal.dataHandler?.('x');
    markUserInput();
    terminal.binaryHandler?.('\u0000');

    expect(callbackA).not.toHaveBeenCalled();
    expect(callbackB).toHaveBeenNthCalledWith(1, 'term-broadcast-remount', 'x');
    expect(callbackB).toHaveBeenNthCalledWith(2, 'term-broadcast-remount', '\u0000', true);
  });

  it('pastes a compatible local path through xterm and marks it as user input', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-drop-local" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const terminal = MockTerminal.instances.at(-1)!;
    const container = document.querySelector('.terminal-container')!;
    const dataTransfer = dataTransferWithPayload({
      version: 1,
      path: '/repo/read me.md',
      entryKind: 'file',
      origin: 'explorer',
      filesystem: { kind: 'local' },
    });

    fireEvent.dragEnter(container, { dataTransfer });

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(container).toHaveClass('is-path-drop-target');
    expect(screen.getByRole('status')).toHaveTextContent('Drop to paste path');

    fireEvent.drop(container, { dataTransfer });

    expect(terminal.paste).toHaveBeenCalledWith("'/repo/read me.md' ");
    expect(terminalWrite).toHaveBeenCalledWith({
      id: 'term-drop-local',
      data: "'/repo/read me.md' ",
      userInput: true,
    });
    expect(terminal.focus).toHaveBeenCalled();
    expect(container).not.toHaveClass('is-path-drop-target');
    expect(screen.queryByText('Drop to paste path')).not.toBeInTheDocument();
  });

  it('routes a same-session SSH path through the SSH shell as user input', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-drop-ssh"
          tabType="ssh"
          sshSessionId="ssh-drop"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(sshCreateShell).toHaveBeenCalled());
    const terminal = MockTerminal.instances.at(-1)!;
    terminal.focus.mockClear();
    const container = document.querySelector('.terminal-container')!;
    const dataTransfer = dataTransferWithPayload({
      version: 1,
      path: '/srv/project/remote file.ts',
      entryKind: 'file',
      origin: 'explorer',
      filesystem: { kind: 'ssh', sessionId: 'ssh-drop' },
    });

    fireEvent.dragOver(container, { dataTransfer });
    expect(container).toHaveClass('is-path-drop-target');
    fireEvent.drop(container, { dataTransfer });

    expect(terminal.paste).toHaveBeenCalledWith("'/srv/project/remote file.ts' ");
    expect(sshWriteShell).toHaveBeenCalledWith({
      sessionId: 'ssh-drop',
      termId: 'term-drop-ssh',
      data: "'/srv/project/remote file.ts' ",
      userInput: true,
    });
    expect(terminalWrite).not.toHaveBeenCalled();
    expect(terminal.focus).toHaveBeenCalled();
  });

  it('shows and retains an invalid state instead of pasting an SSH path into another session', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-drop-mismatch"
          tabType="ssh"
          sshSessionId="ssh-target"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(sshCreateShell).toHaveBeenCalled());
    const terminal = MockTerminal.instances.at(-1)!;
    terminal.focus.mockClear();
    const container = document.querySelector('.terminal-container')!;
    const dataTransfer = dataTransferWithPayload({
      version: 1,
      path: '/home/source/private.txt',
      entryKind: 'file',
      origin: 'explorer',
      filesystem: { kind: 'ssh', sessionId: 'ssh-source' },
    });

    fireEvent.dragEnter(container, { dataTransfer });

    expect(dataTransfer.dropEffect).toBe('none');
    expect(container).toHaveClass('is-path-drop-invalid');
    expect(container.querySelector('.terminal-path-drop-indicator')).toHaveTextContent('Path belongs to another terminal');

    fireEvent.drop(container, { dataTransfer });

    expect(container).toHaveClass('is-path-drop-invalid');
    expect(container.querySelector('.terminal-path-drop-indicator')).toHaveTextContent('Path belongs to another terminal');
    expect(terminal.paste).not.toHaveBeenCalled();
    expect(terminal.focus).not.toHaveBeenCalled();
    expect(sshWriteShell).not.toHaveBeenCalled();
  });

  it('ignores plain-text and malformed custom drops', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-drop-ignore" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const terminal = MockTerminal.instances.at(-1)!;
    const container = document.querySelector('.terminal-container')!;
    const plainText = dataTransferWithText('/repo/plain.txt');
    fireEvent.dragEnter(container, { dataTransfer: plainText });
    fireEvent.drop(container, { dataTransfer: plainText });

    expect(container).not.toHaveClass('is-path-drop-target', 'is-path-drop-invalid');
    expect(terminal.paste).not.toHaveBeenCalled();
    expect(terminalWrite).not.toHaveBeenCalled();

    const malformed = dataTransferWithText('/repo/malformed.txt');
    malformed.setData(TERMINAL_PATH_MIME, '{not json');
    fireEvent.dragEnter(container, { dataTransfer: malformed });
    fireEvent.drop(container, { dataTransfer: malformed });

    expect(container).not.toHaveClass('is-path-drop-target', 'is-path-drop-invalid');
    expect(terminal.paste).not.toHaveBeenCalled();
    expect(terminalWrite).not.toHaveBeenCalled();
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

  it('marks native paste before xterm emits data without tainting the next automatic reply', async () => {
    MockTerminal.nativePasteData = 'pasted text';
    const { default: TerminalPane } = await loadTerminalPane();
    render(
      <KeybindingsProvider>
        <TerminalPane termId="term-native-paste" tabType="local" onReady={vi.fn()} onRemoved={vi.fn()} themeName="tokyo-night" />
      </KeybindingsProvider>,
    );

    const terminal = MockTerminal.instances.at(-1)!;
    terminal.textarea.dispatchEvent(new Event('paste', { bubbles: true }));
    terminal.dataHandler?.('\x1b[1;1R');

    expect(terminalWrite).toHaveBeenNthCalledWith(1, {
      id: 'term-native-paste', data: 'pasted text', userInput: true,
    });
    expect(terminalWrite).toHaveBeenNthCalledWith(2, {
      id: 'term-native-paste', data: '\x1b[1;1R', userInput: false,
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

    act(() => terminalDataHandler!({
      source: 'ssh', id: 'term-ssh', data: 'prompt', generation: 1, sequence: 6,
    }));
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
    act(() => terminalDataHandler!({
      source: 'ssh', id: 'term-ssh-2', data: 'terminal.shop output', generation: 1, sequence: 20,
    }));

    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith(
      'terminal.shop output',
      expect.any(Function),
    );
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

    act(() => terminalDataHandler!({
      source: 'ssh', id: 'term-ssh-3', data: 'ready', generation: 1, sequence: 5,
    }));
    expect(screen.queryByTestId('ssh-terminal-notice')).toBeNull();
  });

  it('starts only one SSH retry when the reconnect button is double-clicked', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    let rejectRetry: (error: Error) => void = () => {};
    const onSshRetry = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectRetry = reject; }));
    sshCreateShellImpl = () => Promise.reject(new Error('Initial shell failure'));

    render(
      <KeybindingsProvider>
        <TerminalPane
          termId="term-ssh-double-retry"
          tabType="ssh"
          sshSessionId="ssh-double-retry"
          onReady={vi.fn()}
          onRemoved={vi.fn()}
          onSshRetry={onSshRetry}
          themeName="tokyo-night"
        />
      </KeybindingsProvider>,
    );

    const retry = await screen.findByTestId('ssh-notice-retry');
    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });

    expect(onSshRetry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('ssh-notice-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');

    await act(async () => rejectRetry(new Error('Reconnect failed')));
    fireEvent.click(await screen.findByTestId('ssh-notice-retry'));
    expect(onSshRetry).toHaveBeenCalledTimes(2);
  });

  it('preserves the initial shell error when its session is marked disconnected', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    sshCreateShellImpl = () => Promise.reject(new Error('Remote shell unavailable'));
    const onReady = vi.fn();
    const onRemoved = vi.fn();
    const onSshRetry = vi.fn(() => Promise.resolve());
    const onShellFailed = vi.fn();

    function Harness() {
      const [connectionLost, setConnectionLost] = React.useState(false);
      const handleShellFailed = React.useCallback((termId: string, sessionId: string) => {
        onShellFailed(termId, sessionId);
        setConnectionLost(true);
      }, []);
      return (
        <TerminalPane
          termId="term-ssh-initial-error"
          tabType="ssh"
          sshSessionId="ssh-initial-error"
          sshConnectionLost={connectionLost}
          onReady={onReady}
          onRemoved={onRemoved}
          onSshShellFailed={handleShellFailed}
          onSshRetry={onSshRetry}
          themeName="tokyo-night"
        />
      );
    }

    render(
      <KeybindingsProvider>
        <Harness />
      </KeybindingsProvider>,
    );

    await waitFor(() => expect(onShellFailed).toHaveBeenCalledWith(
      'term-ssh-initial-error',
      'ssh-initial-error',
    ));
    const notice = await screen.findByTestId('ssh-terminal-notice');
    expect(notice).toHaveTextContent('Remote shell unavailable');
    expect(notice).toHaveAttribute('data-state', 'error');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
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
    expect(await screen.findByTestId('ssh-terminal-notice')).toHaveTextContent('Remote shell unavailable');
    first.unmount();

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );

    expect(screen.getByTestId('ssh-terminal-notice')).toHaveTextContent('Remote shell unavailable');
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
    expect(sshCreateShell).toHaveBeenCalledTimes(1);
  });

  it('publishes initial SSH shell readiness while its cached pane is detached', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    let resolveShell: (value: unknown) => void = () => {};
    sshCreateShellImpl = () => new Promise((resolve) => { resolveShell = resolve; });
    const onSshShellReady = vi.fn();
    const props = {
      termId: 'term-ssh-detached-ready',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-detached-ready',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshShellReady,
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    first.unmount();

    await act(async () => resolveShell({ connected: true }));
    expect(onSshShellReady).toHaveBeenCalledTimes(1);
    expect(onSshShellReady).toHaveBeenCalledWith(props.termId, props.sshSessionId);

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    expect(sshCreateShell).toHaveBeenCalledTimes(1);
    expect(onSshShellReady).toHaveBeenCalledTimes(1);
  });

  it('ignores initial SSH shell readiness after its cached pane is replaced', async () => {
    const { default: TerminalPane, disposeCachedTerminal } = await loadTerminalPane();
    let resolveInitial: (value: unknown) => void = () => {};
    let resolveReplacement: (value: unknown) => void = () => {};
    let shellCount = 0;
    sshCreateShellImpl = () => new Promise((resolve) => {
      shellCount += 1;
      if (shellCount === 1) resolveInitial = resolve;
      else resolveReplacement = resolve;
    });
    const onSshShellReady = vi.fn();
    const props = {
      termId: 'term-ssh-replaced-ready',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-replaced-ready',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshShellReady,
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    first.unmount();
    disposeCachedTerminal(props.termId);

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} hasSession />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(2));

    await act(async () => resolveInitial({ connected: true }));
    expect(onSshShellReady).not.toHaveBeenCalled();

    await act(async () => resolveReplacement({ connected: true }));
    expect(onSshShellReady).toHaveBeenCalledTimes(1);
    expect(onSshShellReady).toHaveBeenCalledWith(props.termId, props.sshSessionId);
  });

  it('publishes initial SSH shell failure while its cached pane is detached', async () => {
    const { default: TerminalPane } = await loadTerminalPane();
    let rejectShell: (error: Error) => void = () => {};
    sshCreateShellImpl = () => new Promise((_resolve, reject) => { rejectShell = reject; });
    const onSshShellFailed = vi.fn();
    const props = {
      termId: 'term-ssh-detached-failed',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-detached-failed',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshShellFailed,
      onSshRetry: vi.fn(() => Promise.resolve()),
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    first.unmount();

    await act(async () => rejectShell(new Error('Detached shell failed')));
    expect(onSshShellFailed).toHaveBeenCalledTimes(1);
    expect(onSshShellFailed).toHaveBeenCalledWith(props.termId, props.sshSessionId);

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    expect(await screen.findByTestId('ssh-terminal-notice')).toHaveTextContent('Detached shell failed');
    expect(sshCreateShell).toHaveBeenCalledTimes(1);
    expect(onSshShellFailed).toHaveBeenCalledTimes(1);
  });

  it('ignores initial SSH shell failure after its cached pane is replaced', async () => {
    const { default: TerminalPane, disposeCachedTerminal } = await loadTerminalPane();
    let rejectInitial: (error: Error) => void = () => {};
    let resolveReplacement: (value: unknown) => void = () => {};
    let shellCount = 0;
    sshCreateShellImpl = () => new Promise((resolve, reject) => {
      shellCount += 1;
      if (shellCount === 1) rejectInitial = reject;
      else resolveReplacement = resolve;
    });
    const onSshShellReady = vi.fn();
    const onSshShellFailed = vi.fn();
    const props = {
      termId: 'term-ssh-replaced-failed',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-replaced-failed',
      onReady: vi.fn(),
      onRemoved: vi.fn(),
      onSshShellReady,
      onSshShellFailed,
      themeName: 'tokyo-night',
    };

    const first = render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(1));
    first.unmount();
    disposeCachedTerminal(props.termId);

    render(
      <KeybindingsProvider>
        <TerminalPane {...props} hasSession />
      </KeybindingsProvider>,
    );
    await waitFor(() => expect(sshCreateShell).toHaveBeenCalledTimes(2));
    await act(async () => resolveReplacement({ connected: true }));
    expect(onSshShellReady).toHaveBeenCalledTimes(1);

    await act(async () => rejectInitial(new Error('Obsolete shell failed')));
    expect(onSshShellFailed).not.toHaveBeenCalled();
    expect(onSshShellReady).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Obsolete shell failed')).not.toBeInTheDocument();
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

    act(() => terminalDataHandler!({
      source: 'ssh', id: props.termId, data: 'prompt while hidden', generation: 1, sequence: 19,
    }));
    render(
      <KeybindingsProvider>
        <TerminalPane {...props} />
      </KeybindingsProvider>,
    );

    expect(screen.queryByTestId('ssh-terminal-notice')).toBeNull();
    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith(
      'prompt while hidden',
      expect.any(Function),
    );
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
    expect(await screen.findByTestId('ssh-terminal-notice')).toHaveTextContent('Transport reconnect failed');
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores an SSH retry that fails after its cached terminal is replaced', async () => {
    const { default: TerminalPane, disposeCachedTerminal } = await loadTerminalPane();
    let rejectRetry: (error: Error) => void = () => {};
    const onSshRetry = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectRetry = reject;
    }));
    sshCreateShellImpl = () => Promise.reject(new Error('Initial shell failure'));
    const props = {
      termId: 'term-ssh-retry-replaced',
      tabType: 'ssh' as const,
      sshSessionId: 'ssh-retry-replaced',
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
    fireEvent.click(await screen.findByTestId('ssh-notice-retry'));
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'reconnecting');

    first.unmount();
    expect(disposeCachedTerminal(props.termId)).toBe(true);
    sshCreateShellImpl = () => Promise.resolve({ connected: true });
    render(
      <KeybindingsProvider>
        <TerminalPane {...props} hasSession />
      </KeybindingsProvider>,
    );
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');

    await act(async () => rejectRetry(new Error('Obsolete retry failed')));
    expect(screen.getByTestId('ssh-terminal-notice')).toHaveAttribute('data-state', 'waiting');
    expect(screen.queryByText('Obsolete retry failed')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
      terminalDataHandler!({
        source: 'ssh', id: 'term-ssh-early-data', data: '\x1b[6n', generation: 1, sequence: 4,
      });
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
    expect(MockTerminal.instances.at(-1)?.write).toHaveBeenCalledWith(
      '\x1b[6n',
      expect.any(Function),
    );
  });
});
