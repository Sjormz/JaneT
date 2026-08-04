import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/renderer/App';
import SplitPane from '../../src/renderer/components/SplitPane';
import type { AgentAwareness } from '../../src/renderer/terminalAwareness';
import type { AgentLifecycleEvent } from '../../src/renderer/terminalAwareness';
import type { SemanticCommandEvent } from '../../src/renderer/semanticCommands';

const mountedTermIds: string[] = [];
const rendererMocks = vi.hoisted(() => ({
  disposeCachedTerminal: vi.fn(),
  paletteActions: [] as Array<{ id: string; handler: () => void }>,
  titlebarProps: null as any,
  shortcutEditorProps: null as any,
  sidebarProps: null as any,
  verticalTabBarProps: null as any,
  prepareForCloseHandler: null as null | ((request: {
    requestId: string;
    reason: 'window-close' | 'application-quit' | 'update-install';
  }) => void | Promise<void>),
  sshConnectionClosedHandler: null as null | ((event: { id: string; reason: string }) => void),
  terminalExitHandler: null as null | ((event: { id: string; exitCode: number; signal: number }) => void),
  sshRetryHandlers: new Map<string, (
    termId: string,
    dimensions: { cols: number; rows: number },
  ) => void | Promise<void>>(),
  cwdChangeHandlers: new Map<string, (termId: string, cwd: string) => void>(),
  agentEventHandlers: new Map<string, (event: AgentLifecycleEvent) => void>(),
  semanticCommandHandlers: new Map<string, (event: SemanticCommandEvent) => void>(),
  broadcastInputHandlers: new Map<string, (data: string, binary?: boolean) => boolean>(),
}));

vi.mock('../../src/renderer/components/Titlebar', () => ({
  default: (props: any) => {
    rendererMocks.titlebarProps = props;
    return <div data-testid="titlebar">{props.settingsOpen ? props.settingsContent : null}</div>;
  },
}));
vi.mock('../../src/renderer/components/VerticalTabBar', () => ({
  default: (props: unknown) => {
    rendererMocks.verticalTabBarProps = props;
    const typedProps = props as any;
    return (
      <div data-testid="vertical-tab-bar">
        {typedProps.tabs.map((tab: { id: string; title: string }) => (
          <span
            key={tab.id}
            data-testid={`outer-tab-${tab.id}`}
            data-dirty={typedProps.dirtyTabIds?.has(tab.id) ? 'true' : 'false'}
            onClick={() => typedProps.onSelectTab(tab.id)}
          >
            {tab.title}
          </span>
        ))}
      </div>
    );
  },
}));
vi.mock('../../src/renderer/components/Sidebar', () => ({
  default: (props: any) => {
    rendererMocks.sidebarProps = props;
    return (
      <aside data-testid="sidebar">
        <button type="button" className="workspace-tool-button" aria-selected="true">
          Mock workspace tool
        </button>
        {props.expanded && (
          <div className="workspace-tools-panel">
            <button type="button">Mock tool content</button>
            <button
              type="button"
              onClick={() => props.onOpenFile({ kind: 'local', path: '/home/test/sample.ts' })}
            >
              Open sample file
            </button>
            <button
              type="button"
              onClick={() => props.onOpenTerminal(props.openLocalTerminals.at(-1).terminalId)}
            >
              Focus last open terminal
            </button>
          </div>
        )}
      </aside>
    );
  },
}));
vi.mock('../../src/renderer/components/StatusBar', () => ({
  default: ({ sshSessions }: {
    sshSessions: unknown[];
  }) => (
    <div
      data-testid="statusbar"
      data-ssh-count={sshSessions.length}
    />
  ),
}));
vi.mock('../../src/renderer/components/CommandPalette', () => ({
  default: ({ actions }: { actions: Array<{ id: string; handler: () => void }> }) => {
    rendererMocks.paletteActions = actions;
    return null;
  },
}));
vi.mock('../../src/renderer/components/ShortcutEditor', () => ({
  default: (props: any) => {
    rendererMocks.shortcutEditorProps = props;
    return props.open ? (
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <button type="button" onClick={props.onClose}>Close keyboard shortcuts</button>
      </div>
    ) : null;
  },
}));
vi.mock('../../src/renderer/components/UpdateBanner', () => ({
  default: () => null,
}));
vi.mock('../../src/renderer/components/MonacoEditor', () => ({
  default: ({ document, onChange, onSave }: any) => (
    <div data-testid={`mock-editor-${document.key}`}>
      <textarea
        aria-label={`Editing ${document.title}`}
        value={document.content}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button type="button" onClick={onSave}>Save from editor</button>
    </div>
  ),
  disposeEditorDocumentModel: vi.fn(),
  disposeAllEditorDocumentModels: vi.fn(),
}));
vi.mock('../../src/renderer/components/TerminalPane', async () => {
  const React = await import('react');

  function MockTerminalPane({
    termId,
    hasSession,
    initialCwd,
    tabType,
    sshSessionId,
    sshShellReady = true,
    sshConnectionLost = false,
    startupCommands,
    startupShellDialect,
    onReady,
    onRemoved,
    onCwdChange,
    onFocus,
    onSshRetry,
    onAgentEvent,
    onSemanticCommand,
    onBroadcastInput,
  }: {
    termId: string;
    hasSession?: boolean;
    initialCwd?: string;
    tabType?: 'local' | 'ssh';
    sshSessionId?: string;
    sshShellReady?: boolean;
    sshConnectionLost?: boolean;
    startupCommands?: string[];
    startupShellDialect?: 'posix' | 'fish' | 'powershell';
    onReady?: (id: string) => void;
    onRemoved?: (id: string) => void;
    onCwdChange?: (id: string, cwd: string) => void;
    onFocus?: (id: string) => void;
    onSshRetry?: (
      id: string,
      dimensions: { cols: number; rows: number },
    ) => void | Promise<void>;
    onAgentEvent?: (termId: string, event: AgentLifecycleEvent) => void;
    onSemanticCommand?: (termId: string, event: SemanticCommandEvent) => void;
    onBroadcastInput?: (termId: string, data: string, binary?: boolean) => boolean;
  }) {
    if (onSshRetry) rendererMocks.sshRetryHandlers.set(termId, onSshRetry);
    if (onCwdChange) rendererMocks.cwdChangeHandlers.set(termId, onCwdChange);
    if (onAgentEvent) rendererMocks.agentEventHandlers.set(termId, (event) => onAgentEvent(termId, event));
    if (onSemanticCommand) rendererMocks.semanticCommandHandlers.set(termId, (event) => onSemanticCommand(termId, event));
    if (onBroadcastInput) rendererMocks.broadcastInputHandlers.set(termId, (data, binary) => onBroadcastInput(termId, data, binary));
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
      const textarea = document.createElement('textarea');
      textarea.setAttribute('aria-label', `Terminal ${termId}`);
      containerRef.current?.appendChild(textarea);
      mountedTermIds.push(termId);
      return () => {
        textarea.remove();
        onRemoved?.(termId);
      };
    }, [termId, onRemoved]);

    React.useEffect(() => {
      if (!hasSession) {
        if (tabType === 'ssh') {
          if (sshSessionId && sshShellReady) {
            window.janet.sshCreateShell({
              id: sshSessionId,
              termId,
              cols: 80,
              rows: 24,
              ...(startupCommands?.length ? { startupCommands } : {}),
              ...(startupShellDialect ? { startupShellDialect } : {}),
            });
            onReady?.(termId);
          }
        } else if (tabType === 'local') {
          window.janet.terminalCreate({
            id: termId,
            cwd: initialCwd,
            ...(startupCommands?.length ? { startupCommands } : {}),
            ...(startupShellDialect ? { startupShellDialect } : {}),
          });
          onReady?.(termId);
        } else {
          onReady?.(termId);
          return;
        }
      } else {
        onReady?.(termId);
      }
    }, [termId, hasSession, initialCwd, tabType, sshSessionId, sshShellReady, startupCommands, startupShellDialect, onReady]);

    return (
      <div
        ref={containerRef}
        data-testid={`terminal-${termId}`}
        data-terminal-focus-target
        data-terminal-id={termId}
        data-ssh-connection-lost={sshConnectionLost ? 'true' : 'false'}
        onFocus={() => onFocus?.(termId)}
      >
        {termId}
      </div>
    );
  }

  return { default: MockTerminalPane, disposeCachedTerminal: rendererMocks.disposeCachedTerminal };
});

beforeEach(() => {
  mountedTermIds.length = 0;
  rendererMocks.disposeCachedTerminal.mockReset();
  rendererMocks.paletteActions = [];
  rendererMocks.titlebarProps = null;
  rendererMocks.shortcutEditorProps = null;
  rendererMocks.sidebarProps = null;
  rendererMocks.verticalTabBarProps = null;
  rendererMocks.prepareForCloseHandler = null;
  rendererMocks.sshConnectionClosedHandler = null;
  rendererMocks.terminalExitHandler = null;
  rendererMocks.sshRetryHandlers.clear();
  rendererMocks.cwdChangeHandlers.clear();
  rendererMocks.agentEventHandlers.clear();
  rendererMocks.semanticCommandHandlers.clear();
  rendererMocks.broadcastInputHandlers.clear();
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
    }),
  });
  (window as any).janet = {
    fsGetHome: vi.fn().mockResolvedValue('/home/test'),
    fsReadTextFile: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        requestedPath: '/home/test/sample.ts',
        resolvedPath: '/home/test/sample.ts',
        content: 'export const answer = 42;\n',
        encoding: 'utf8',
        hasUtf8Bom: false,
        revision: {
          token: 'a'.repeat(64),
          size: 26,
          mtime: '2026-07-16T00:00:00.000Z',
          fileId: '1:2',
        },
      },
    }),
    fsWriteTextFile: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        requestedPath: '/home/test/sample.ts',
        resolvedPath: '/home/test/sample.ts',
        revision: {
          token: 'b'.repeat(64),
          size: 26,
          mtime: '2026-07-16T00:01:00.000Z',
          fileId: '1:2',
        },
      },
    }),
    getSettings: vi.fn().mockResolvedValue({ keybindings: {}, workspaceTabs: [], notificationsEnabled: false, notificationThresholdSeconds: 10 }),
    setSettings: vi.fn().mockResolvedValue(undefined),
    notifyCommandCompleted: vi.fn().mockResolvedValue(true),
    terminalCreate: vi.fn().mockResolvedValue(undefined),
    terminalDestroy: vi.fn().mockResolvedValue(undefined),
    terminalWrite: vi.fn(),
    terminalWriteBinary: vi.fn(),
    terminalResize: vi.fn(),
    onTerminalData: vi.fn(() => ({ dispose: vi.fn() })),
    onTerminalExit: vi.fn((callback: (event: { id: string; exitCode: number; signal: number }) => void) => {
      rendererMocks.terminalExitHandler = callback;
      return () => {
        if (rendererMocks.terminalExitHandler === callback) rendererMocks.terminalExitHandler = null;
      };
    }),
    sshConnect: vi.fn().mockResolvedValue({ connected: true }),
    sshCreateShell: vi.fn().mockResolvedValue(undefined),
    sshWriteShell: vi.fn(),
    sshWriteShellBinary: vi.fn(),
    sshResizeShell: vi.fn(),
    sshDestroyShell: vi.fn().mockResolvedValue(true),
    sshDisconnect: vi.fn().mockResolvedValue(undefined),
    onSSHConnectionClosed: vi.fn((callback: (event: { id: string; reason: string }) => void) => {
      rendererMocks.sshConnectionClosedHandler = callback;
      return () => {
        if (rendererMocks.sshConnectionClosedHandler === callback) {
          rendererMocks.sshConnectionClosedHandler = null;
        }
      };
    }),
    onPrepareForClose: vi.fn((callback: typeof rendererMocks.prepareForCloseHandler) => {
      rendererMocks.prepareForCloseHandler = callback;
      return () => {
        if (rendererMocks.prepareForCloseHandler === callback) {
          rendererMocks.prepareForCloseHandler = null;
        }
      };
    }),
    resolvePrepareForClose: vi.fn().mockResolvedValue(true),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
  };
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const semanticEvent = (command: string, output = 'private output'): SemanticCommandEvent => ({
  command, output, exitCode: 0, startedAt: 10, completedAt: 20, durationMs: 10,
});

function historyUpdates() {
  return vi.mocked(window.janet.setSettings).mock.calls
    .map(([update]) => update as any)
    .filter((update) => Array.isArray(update.commandHistory));
}

async function confirmPendingAction(name: RegExp) {
  const dialog = await screen.findByRole('alertdialog');
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name }));
  });
}

async function openSampleEditor(): Promise<HTMLTextAreaElement> {
  const openButton = await screen.findByRole('button', { name: 'Open sample file' });
  fireEvent.click(openButton);
  const editor = await screen.findByRole('textbox', { name: 'Editing sample.ts' });
  await waitFor(() => {
    expect(window.janet.fsReadTextFile).toHaveBeenCalledWith({ filePath: '/home/test/sample.ts' });
  });
  return editor as HTMLTextAreaElement;
}

async function requestWorkspaceClose(
  requestId: string,
  reason: 'window-close' | 'application-quit' | 'update-install' = 'window-close',
) {
  await waitFor(() => expect(rendererMocks.prepareForCloseHandler).toBeTypeOf('function'));
  await act(async () => {
    await rendererMocks.prepareForCloseHandler!({ requestId, reason });
  });
}

describe('split panes in the app', () => {
  it('propagates semantic commands from nested and maximized leaves with explicit tab ownership', () => {
    const onSemanticCommand = vi.fn();
    const event: SemanticCommandEvent = {
      command: 'printf ok', output: 'ok', exitCode: 0,
      startedAt: 10, completedAt: 20, durationMs: 10,
    };
    const node = {
      id: 'root', type: 'split' as const, direction: 'vertical' as const, sizes: [1],
      children: [{
        id: 'nested', type: 'split' as const, direction: 'horizontal' as const, sizes: [1],
        children: [{ id: 'term-deep', type: 'leaf' as const }],
      }],
    };
    const required = {
      tabId: 'tab-1', tabType: 'local' as const, onTerminalReady: vi.fn(), onTerminalRemoved: vi.fn(),
      onSplitPane: vi.fn(), onClosePane: vi.fn(), onResizePane: vi.fn(), onMovePane: vi.fn(),
      onPaneDragStart: vi.fn(), onPaneDragOver: vi.fn(), onPaneDragEnd: vi.fn(), onToggleMaximizePane: vi.fn(),
      onSemanticCommand,
    };
    const view = render(<SplitPane node={node} {...required} />);
    act(() => rendererMocks.semanticCommandHandlers.get('term-deep')!(event));
    expect(onSemanticCommand).toHaveBeenLastCalledWith('tab-1', 'term-deep', event);

    view.rerender(<SplitPane node={node} maximizedLeafId="term-deep" {...required} />);
    act(() => rendererMocks.semanticCommandHandlers.get('term-deep')!(event));
    expect(onSemanticCommand).toHaveBeenLastCalledWith('tab-1', 'term-deep', event);
    expect(onSemanticCommand).toHaveBeenCalledTimes(2);
  });
  it('broadcasts only after deliberate confirmation and offers immediate cancel', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    const terminals = await screen.findAllByTestId(/terminal-/);
    const [firstId, secondId] = terminals.map((terminal) => terminal.dataset.terminalId!);

    const recipients = screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i });
    expect(recipients[0].closest('label')).toHaveClass('broadcast-toggle');
    expect(recipients[0].closest('label')?.querySelector('svg')).not.toBeNull();
    fireEvent.click(recipients[0]);
    expect(screen.queryByRole('status', { name: /broadcast input active/i })).toBeNull();
    expect(rendererMocks.broadcastInputHandlers.get(firstId)!('not active')).toBe(false);
    expect(window.janet.terminalWrite).not.toHaveBeenCalledWith(expect.objectContaining({ data: 'not active' }));
    fireEvent.click(recipients[1]);

    const dialog = screen.getByRole('alertdialog', { name: 'Start broadcast input?' });
    expect(dialog).toHaveTextContent('typing and paste');
    expect(dialog).toHaveTextContent('multiline or destructive commands');
    expect(dialog).toHaveTextContent('2 selected panes');
    expect(rendererMocks.broadcastInputHandlers.get(firstId)!('still not active')).toBe(false);
    expect(window.janet.terminalWrite).not.toHaveBeenCalledWith(expect.objectContaining({ data: 'still not active' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start broadcast input' }));

    expect(screen.getByRole('status', { name: /broadcast input active/i })).toHaveTextContent('Broadcast input active · 2 panes');
    expect(recipients[0].closest('.terminal-leaf')).toHaveClass('broadcast-selected');
    expect(recipients[1].closest('.terminal-leaf')).toHaveClass('broadcast-selected');
    expect(rendererMocks.broadcastInputHandlers.get(firstId)!('echo safe')).toBe(true);
    expect(window.janet.terminalWrite).toHaveBeenCalledWith({ id: firstId, data: 'echo safe', userInput: true });
    expect(window.janet.terminalWrite).toHaveBeenCalledWith({ id: secondId, data: 'echo safe', userInput: true });
    expect(window.janet.terminalWrite).toHaveBeenCalledTimes(2);
    expect(rendererMocks.broadcastInputHandlers.get(secondId)!('\u0000', true)).toBe(true);
    expect(window.janet.terminalWriteBinary).toHaveBeenCalledTimes(2);
    expect(window.janet.terminalWriteBinary).toHaveBeenCalledWith({ id: firstId, data: '\u0000', userInput: true });
    expect(window.janet.terminalWriteBinary).toHaveBeenCalledWith({ id: secondId, data: '\u0000', userInput: true });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel broadcast input' }));
    expect(screen.queryByRole('status', { name: /broadcast input active/i })).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).every(
      (checkbox) => !(checkbox as HTMLInputElement).checked,
    )).toBe(true);
  });

  it('keeps broadcasting off and clears candidates when activation is cancelled', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    const firstId = (await screen.findAllByTestId(/terminal-/))[0].dataset.terminalId!;
    screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).forEach((checkbox) => fireEvent.click(checkbox));

    const dialog = screen.getByRole('alertdialog', { name: 'Start broadcast input?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.click(cancel);

    expect(screen.queryByRole('status', { name: /broadcast input active/i })).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).every(
      (checkbox) => !(checkbox as HTMLInputElement).checked,
    )).toBe(true);
    expect(rendererMocks.broadcastInputHandlers.get(firstId)!('cancelled')).toBe(false);
    expect(window.janet.terminalWrite).not.toHaveBeenCalledWith(expect.objectContaining({ data: 'cancelled' }));
  });

  it('cancels broadcast immediately with Escape and when a recipient exits', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    const terminals = await screen.findAllByTestId(/terminal-/);
    const [firstId, secondId] = terminals.map((terminal) => terminal.dataset.terminalId!);
    screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start broadcast input' }));

    const terminalKeyDown = vi.fn();
    terminals[0].addEventListener('keydown', terminalKeyDown);
    fireEvent.keyDown(terminals[0], { key: 'Escape' });
    expect(screen.queryByRole('status', { name: /broadcast input active/i })).toBeNull();
    expect(terminalKeyDown).not.toHaveBeenCalled();

    screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start broadcast input' }));
    act(() => rendererMocks.terminalExitHandler!({ id: secondId, exitCode: 0, signal: 0 }));
    expect(screen.queryByRole('status', { name: /broadcast input active/i })).toBeNull();
    expect(rendererMocks.broadcastInputHandlers.get(firstId)!('must not fan out')).toBe(false);
    expect(window.janet.terminalWrite).not.toHaveBeenCalledWith(expect.objectContaining({ data: 'must not fan out' }));
  });

  it('keeps recipients scoped to the visible tab', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start broadcast input' }));
    expect(screen.getByRole('status', { name: /broadcast input active/i })).toBeInTheDocument();

    act(() => rendererMocks.verticalTabBarProps.onNewTab());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2));
    expect(screen.queryByRole('status', { name: /broadcast input active/i })).toBeNull();
    expect(screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i })).toHaveLength(1);
  });

  it('serializes output-free history writes, publishes only successes, and rolls back a failed write', async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => {
      if (!update.commandHistory) return Promise.resolve();
      return historyUpdates().length === 1 ? first.promise : second.promise;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<App />);
      const terminal = await screen.findByTestId(/terminal-/);
      await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget?.path).toBe('/home/test'));
      const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;
      act(() => { emit(semanticEvent('printf first', 'FIRST OUTPUT')); emit(semanticEvent('printf second', 'SECOND OUTPUT')); });

      await waitFor(() => expect(historyUpdates()).toHaveLength(1));
      expect(JSON.stringify(historyUpdates()[0])).not.toMatch(/output|FIRST OUTPUT|SECOND OUTPUT/i);
      act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
      expect(screen.getByRole('dialog', { name: 'Command history' })).not.toHaveTextContent('printf first');
      expect(historyUpdates()).toHaveLength(1);

      await act(async () => first.reject(new Error('disk full')));
      await waitFor(() => expect(historyUpdates()).toHaveLength(2));
      expect(historyUpdates()[1].commandHistory.map((item: any) => item.command)).toEqual(['printf second']);
      expect(screen.getByRole('dialog', { name: 'Command history' })).not.toHaveTextContent('printf second');
      await act(async () => second.resolve());
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'Command history' })).toHaveTextContent('printf second'));
      expect(consoleError).toHaveBeenCalledWith('Failed to save command history:', expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });

  it('persists overlapping successful completions in callback order without loss', async () => {
    const first = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => (
      update.commandHistory && historyUpdates().length === 1 ? first.promise : Promise.resolve()
    ));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget?.path).toBe('/home/test'));
    const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;
    act(() => { emit(semanticEvent('first')); emit(semanticEvent('second')); });
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    expect(historyUpdates()[0].commandHistory.map((item: any) => item.command)).toEqual(['first']);

    await act(async () => first.resolve());
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));
    expect(historyUpdates()[1].commandHistory.map((item: any) => item.command)).toEqual(['second', 'first']);
  });

  it('replaces an older duplicate command instead of adding another row', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget?.path).toBe('/home/test'));
    const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;

    act(() => emit({ ...semanticEvent('repeat'), startedAt: 10 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    act(() => emit({ ...semanticEvent('repeat'), startedAt: 30 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));

    expect(historyUpdates()[1].commandHistory).toHaveLength(1);
    expect(historyUpdates()[1].commandHistory[0]).toMatchObject({ command: 'repeat', startedAt: 30 });
  });

  it('removes a command-history entry from settings and the picker', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget?.path).toBe('/home/test'));
    const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;
    act(() => emit(semanticEvent('remove me')));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
    const dialog = await screen.findByRole('dialog', { name: 'Command history' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove remove me from command history' }));

    await waitFor(() => expect(historyUpdates()).toHaveLength(2));
    expect(historyUpdates()[1].commandHistory).toEqual([]);
    expect(within(dialog).queryByRole('option', { name: 'remove me' })).toBeNull();
  });

  it('resolves ownership and local context only when a queued completion persists', async () => {
    const blocker = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => (
      update.commandHistory && historyUpdates().length === 1 ? blocker.promise : Promise.resolve()
    ));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget?.path).toBe('/home/test'));
    const termId = terminal.dataset.terminalId!;
    const emit = rendererMocks.semanticCommandHandlers.get(termId)!;
    act(() => { emit(semanticEvent('first')); emit(semanticEvent('second')); });
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));

    act(() => rendererMocks.cwdChangeHandlers.get(termId)!(termId, '/queued/cwd'));
    await act(async () => blocker.resolve());
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));
    expect(historyUpdates()[1].commandHistory[0]).toMatchObject({
      command: 'second', context: { kind: 'local', cwd: '/queued/cwd' },
    });
  });

  it('drops queued completions whose exact tab and terminal ownership was removed', async () => {
    const blocker = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => (
      update.commandHistory && historyUpdates().length === 1 ? blocker.promise : Promise.resolve()
    ));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget?.path).toBe('/home/test'));
    const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;
    act(() => { emit(semanticEvent('first')); emit(semanticEvent('stale')); });
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /close (?:pane|terminal tab)/i }));
    await confirmPendingAction(/^close tab$/i);
    await act(async () => blocker.resolve());
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    await act(async () => Promise.resolve());
    expect(historyUpdates()).toHaveLength(1);
  });

  it('re-resolves the active focused terminal when history selection pastes without Enter', async () => {
    const pasted = vi.fn();
    window.addEventListener('janet:terminal-paste-request', pasted);
    try {
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
      const terminals = await screen.findAllByTestId(/terminal-/);
      const firstId = terminals[0].dataset.terminalId!;
      const secondId = terminals[1].dataset.terminalId!;
      act(() => rendererMocks.semanticCommandHandlers.get(firstId)!(
        semanticEvent(`printf chosen${String.fromCharCode(13, 10)}`),
      ));
      await waitFor(() => expect(historyUpdates()).toHaveLength(1));
      fireEvent.focus(terminals[0]);
      act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
      const dialog = await screen.findByRole('dialog', { name: 'Command history' });
      fireEvent.focus(terminals[1]);
      fireEvent.click(within(dialog).getByRole('option', { name: /printf chosen/ }));

      expect(pasted).toHaveBeenCalledTimes(1);
      expect((pasted.mock.calls[0][0] as CustomEvent).detail).toEqual({ termId: secondId, text: 'printf chosen' });
      expect(window.janet.terminalWrite).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('janet:terminal-paste-request', pasted);
    }
  });

  it('maps an owned semantic event to bounded command-free local notification metadata', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const termId = terminal.dataset.terminalId!;
    const event: SemanticCommandEvent = {
      command: 'secret command', output: 'secret output', exitCode: 0,
      startedAt: 10, completedAt: 10_010, durationMs: 10_000,
    };
    act(() => rendererMocks.semanticCommandHandlers.get(termId)!(event));
    await waitFor(() => expect(window.janet.notifyCommandCompleted).toHaveBeenCalledOnce());
    expect(window.janet.notifyCommandCompleted).toHaveBeenCalledWith({
      durationMs: 10_000, outcome: 'success', tabLabel: 'Terminal', paneLabel: 'Terminal', context: { kind: 'local' },
    });
    expect(JSON.stringify(vi.mocked(window.janet.notifyCommandCompleted).mock.calls)).not.toMatch(/secret command|secret output|command|output/);
  });

  it('does not notify after exact tab ownership becomes stale', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const termId = terminal.dataset.terminalId!;
    const staleHandler = rendererMocks.semanticCommandHandlers.get(termId)!;
    const oldTabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    act(() => rendererMocks.verticalTabBarProps.onNewTab());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2));
    act(() => rendererMocks.verticalTabBarProps.onCloseTab(oldTabId));
    await confirmPendingAction(/close tab/i);
    act(() => staleHandler({ command: 'secret', output: 'secret', startedAt: 0, completedAt: 10_000, durationMs: 10_000 }));
    expect(window.janet.notifyCommandCompleted).not.toHaveBeenCalled();
  });

  it('shows an authoritative local terminal exit in its pane and tab', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const termId = terminal.dataset.terminalId!;
    const tabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    await waitFor(() => expect(rendererMocks.terminalExitHandler).toBeTypeOf('function'));

    act(() => rendererMocks.agentEventHandlers.get(termId)!({
      version: 1, provider: 'hermes', event: 'session.start',
      sessionId: 'session-1',
    }));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toEqual({ kind: 'ready', label: 'Hermes · Ready' }));

    act(() => rendererMocks.terminalExitHandler!({ id: termId, exitCode: 17, signal: 0 }));

    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toEqual({ kind: 'exited', label: 'Exited' }));
    expect(screen.getByText('Exited')).toHaveClass('leaf-awareness', 'exited');
  });

  it('marks a background turn outcome unseen and acknowledges it when its tab is selected', async () => {
    render(<App />);
    const firstTerminal = await screen.findByTestId(/terminal-/);
    const firstTerminalId = firstTerminal.dataset.terminalId!;
    const firstTabId = rendererMocks.verticalTabBarProps.tabs[0].id;

    act(() => rendererMocks.verticalTabBarProps.onNewTab());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2));

    const emit = rendererMocks.agentEventHandlers.get(firstTerminalId)!;
    act(() => {
      emit({
        version: 1, provider: 'hermes', event: 'turn.start',
        sessionId: 'session-1', turnId: 'turn-1',
      });
      emit({
        version: 1, provider: 'hermes', event: 'turn.end',
        sessionId: 'session-1', turnId: 'turn-1', outcome: 'succeeded',
      });
    });

    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[firstTabId])
      .toEqual({ kind: 'finished', label: 'Hermes · Turn finished' }));

    act(() => rendererMocks.verticalTabBarProps.onSelectTab(firstTabId));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[firstTabId])
      .toEqual({ kind: 'ready', label: 'Hermes · Ready' }));
    expect(screen.getByText('Hermes · Ready')).toHaveClass('leaf-awareness', 'ready');
  });

  it('opens snippets with the configured shortcut and routes pasted content to the focused terminal', async () => {
    const pasted = vi.fn();
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: { 'palette-toggle': 'Ctrl+K', 'snippets-toggle': 'Ctrl+Shift+P' }, workspaceTabs: [],
      notificationsEnabled: false, notificationThresholdSeconds: 10,
    });
    window.addEventListener('janet:terminal-paste-request', pasted);
    try {
      render(<App />);
      await screen.findByRole('button', { name: /split pane right/i });
      (await screen.findByTestId(/terminal-/)).focus();

      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'P', ctrlKey: true, shiftKey: true });
        expect(screen.getByRole('dialog', { name: 'Snippets' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'New snippet' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Snippet name' }), { target: { value: 'Follow logs' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'Snippet content' }), { target: { value: 'docker compose logs -f\n' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save snippet' }));

      fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search snippets' }), { key: 'Enter' });
      await waitFor(() => expect(pasted).toHaveBeenCalledTimes(1));
      expect(pasted.mock.calls[0][0].detail.text).toBe('docker compose logs -f');
      expect(pasted.mock.calls[0][0].detail.text).not.toMatch(/\n$/);
      expect((window.janet.setSettings as ReturnType<typeof vi.fn>).mock.calls).toContainEqual([
        { snippets: [expect.objectContaining({ name: 'Follow logs', content: 'docker compose logs -f\n' })] },
      ]);
    } finally {
      window.removeEventListener('janet:terminal-paste-request', pasted);
    }
  });

  it('keeps existing terminals alive when splitting deeper panes', async () => {
    render(<App />);

    const splitButton = await screen.findByRole('button', { name: /split pane right/i });
    await waitFor(() => {
      expect(mountedTermIds).toHaveLength(1);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1);
    });
    expect(window.janet.getSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(splitButton);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(mountedTermIds).toHaveLength(2);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
      expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    });

    const splitButtons = screen.getAllByRole('button', { name: /split pane right/i });
    fireEvent.click(splitButtons[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(3);
      expect(mountedTermIds).toHaveLength(3);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(3);
      expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    });

    expect(new Set(mountedTermIds).size).toBe(3);
  });

  it('moves an existing pane without creating or destroying a terminal', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split pane right/i });
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    const [firstTerminal, secondTerminal] = screen.getAllByTestId(/terminal-/);
    const firstLeaf = firstTerminal.closest('.terminal-leaf')!;
    const secondLeaf = secondTerminal.closest('.terminal-leaf')!;
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() };

    fireEvent.dragStart(secondLeaf.querySelector('.terminal-leaf-header')!, { dataTransfer });
    fireEvent.dragOver(firstLeaf, { dataTransfer, clientX: 0, clientY: 0 });
    fireEvent.drop(firstLeaf, { dataTransfer, clientX: 0, clientY: 0 });

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/).map((element) => element.textContent)).toEqual([
        secondTerminal.textContent,
        firstTerminal.textContent,
      ]);
    });
    expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
  });

  it('surviving pane fills space when sibling is closed', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split pane right/i });
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    // Close the second pane
    const closeButtons = screen.getAllByRole('button', { name: /close (?:pane|terminal tab)/i });
    fireEvent.click(closeButtons[1]);
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    await confirmPendingAction(/^close pane$/i);

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    await waitFor(() => expect(within(screen.getByTestId(/terminal-/)).getByRole('textbox')).toHaveFocus());

    // Survivor must be sized from React state, not from stale inline styles.
    const survivor = document.querySelector<HTMLElement>('.split-child');
    expect(survivor).toBeTruthy();
    expect(survivor!.style.flex).toBe('1 1 0%');
  });

  it('applies the close-pane shortcut to the focused pane', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split pane right/i });
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    const [firstTerminal, secondTerminal] = screen.getAllByTestId(/terminal-/);
    const firstId = firstTerminal.textContent!;
    const secondId = secondTerminal.textContent!;
    fireEvent.focus(secondTerminal);
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true, shiftKey: true });
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
    expect(within(dialog).getByRole('button', { name: 'Close pane' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Close tab' })).not.toBeInTheDocument();
    await confirmPendingAction(/^close pane$/i);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/).map((terminal) => terminal.textContent)).toEqual([firstId]);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(window.janet.terminalDestroy).toHaveBeenCalledTimes(1);
    expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: secondId });
  });

  it('renames the focused pane with F2 and returns focus to its terminal', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const [firstTerminal, secondTerminal] = screen.getAllByTestId(/terminal-/);
    const secondInput = within(secondTerminal).getByRole('textbox');
    act(() => secondInput.focus());
    vi.mocked(window.janet.terminalCreate).mockClear();
    vi.mocked(window.janet.terminalDestroy).mockClear();

    fireEvent.keyDown(secondInput, { key: 'F2' });

    const dialog = await screen.findByRole('dialog', { name: 'Rename terminal' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Terminal name' });
    expect(nameInput).toHaveValue('Terminal');
    await waitFor(() => {
      expect(nameInput).toHaveFocus();
      expect(nameInput).toHaveSelection('Terminal');
    });
    fireEvent.change(nameInput, { target: { value: '  Tests  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename terminal' })).not.toBeInTheDocument();
      expect(screen.getByText('Tests')).toBeInTheDocument();
      expect(secondInput).toHaveFocus();
    });
    expect(firstTerminal).toBeInTheDocument();
    expect(secondTerminal).toBeInTheDocument();
    expect(window.janet.terminalCreate).not.toHaveBeenCalled();
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    expect(window.janet.sshCreateShell).not.toHaveBeenCalled();
    expect(window.janet.sshDestroyShell).not.toHaveBeenCalled();

    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    const settingsCalls = vi.mocked(window.janet.setSettings).mock.calls;
    const savedRoot = (settingsCalls.at(-1)?.[0] as any).session?.tabs?.[0]?.root;
    expect(savedRoot.children[1]).toMatchObject({ title: 'Tests', terminalType: 'local' });
  });

  it('renames the active tab with Ctrl+F2 while its rail is collapsed', async () => {
    render(<App />);

    const terminal = await screen.findByTestId(/terminal-/);
    const terminalInput = await within(terminal).findByRole('textbox');
    act(() => terminalInput.focus());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps?.onCollapse).toBeTypeOf('function'));
    act(() => rendererMocks.verticalTabBarProps.onCollapse());
    expect(await screen.findByRole('button', { name: 'Show terminal tabs' })).toBeInTheDocument();

    fireEvent.keyDown(terminalInput, { key: 'F2', ctrlKey: true });

    const dialog = await screen.findByRole('dialog', { name: 'Rename tab' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Tab name' });
    expect(nameInput).toHaveValue('Terminal');
    await waitFor(() => {
      expect(nameInput).toHaveFocus();
      expect(nameInput).toHaveSelection('Terminal');
    });
    fireEvent.change(nameInput, { target: { value: 'JaneT - fixes' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Rename tab' })).not.toBeInTheDocument();
      expect(terminalInput).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show terminal tabs' }));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs[0].title).toBe('JaneT - fixes'));
  });

  it('cycles terminal tabs with Ctrl+Tab while the tab rail is collapsed', async () => {
    render(<App />);

    const firstTerminalTestId = (await screen.findByTestId(/terminal-/)).getAttribute('data-testid')!;
    act(() => rendererMocks.verticalTabBarProps.onNewTab());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2));
    const [firstTab, secondTab] = rendererMocks.verticalTabBarProps.tabs;
    expect(rendererMocks.verticalTabBarProps.activeTabId).toBe(secondTab.id);
    const secondTerminalTestId = screen.getByTestId(/terminal-/).getAttribute('data-testid')!;
    act(() => rendererMocks.verticalTabBarProps.onCollapse());

    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    await screen.findByTestId(firstTerminalTestId);

    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await screen.findByTestId(secondTerminalTestId);
  });

  it('opens settings and resets the terminal text size from their shortcuts', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {}, workspaceTabs: [], fontSize: 18,
      notificationsEnabled: false, notificationThresholdSeconds: 10,
    });
    render(<App />);
    await screen.findByTestId('titlebar');

    fireEvent.keyDown(document, { key: ',', ctrlKey: true });
    await waitFor(() => expect(rendererMocks.titlebarProps.settingsOpen).toBe(true));
    act(() => rendererMocks.titlebarProps.onSettingsClose());

    fireEvent.keyDown(document, { key: '0', ctrlKey: true });
    await waitFor(() => expect(window.janet.setSettings).toHaveBeenCalledWith({ fontSize: 14 }));
  });

  it('opens keyboard shortcut editing in a modal from Settings', async () => {
    render(<App />);
    await screen.findByTestId('titlebar');

    fireEvent.keyDown(document, { key: ',', ctrlKey: true });
    const openShortcuts = await screen.findByRole('button', { name: 'Keyboard shortcuts' });
    fireEvent.click(openShortcuts);

    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(rendererMocks.titlebarProps.settingsOpen).toBe(false);
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument());
  });

  it('exposes unassigned optional actions in the palette', async () => {
    render(<App />);
    await screen.findByTestId(/terminal-/);

    await waitFor(() => expect(rendererMocks.paletteActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'settings-toggle', shortcut: 'Ctrl+,' }),
      expect.objectContaining({ id: 'font-reset', shortcut: 'Ctrl+0' }),
      expect.objectContaining({ id: 'history-toggle', shortcut: '' }),
      expect.objectContaining({ id: 'maximize-pane', shortcut: '' }),
      expect.objectContaining({ id: 'focus-next-pane', shortcut: '' }),
      expect.objectContaining({ id: 'focus-previous-pane', shortcut: '' }),
      expect.objectContaining({ id: 'save-document', shortcut: '' }),
      expect.objectContaining({ id: 'close-document', shortcut: '' }),
    ])));
  });

  it('requires confirmation before the close-tab shortcut destroys its terminal', async () => {
    render(<App />);

    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.textContent!;
    fireEvent.focus(terminal);
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });

    const dialog = await screen.findByRole('alertdialog');
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId(`terminal-${terminalId}`)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
    await confirmPendingAction(/^close tab$/i);
    await waitFor(() => {
      expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: terminalId });
    });
  });

  it('routes the terminal-tab close control through the same confirmation gate', async () => {
    render(<App />);

    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.textContent!;
    await waitFor(() => expect(rendererMocks.verticalTabBarProps?.onCloseTab).toBeTypeOf('function'));

    act(() => {
      rendererMocks.verticalTabBarProps.onCloseTab(rendererMocks.verticalTabBarProps.tabs[0].id);
    });

    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    await confirmPendingAction(/^close tab$/i);
    await waitFor(() => {
      expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: terminalId });
    });
    await waitFor(() => expect(within(screen.getByTestId(/terminal-/)).getByRole('textbox')).toHaveFocus());
  });

  it('routes the command-palette close-tab action through confirmation', async () => {
    render(<App />);

    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.textContent!;
    await waitFor(() => {
      expect(rendererMocks.paletteActions.find((action) => action.id === 'close-tab')).toBeTruthy();
    });

    act(() => {
      rendererMocks.paletteActions.find((action) => action.id === 'close-tab')!.handler();
    });

    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    await confirmPendingAction(/^close tab$/i);
    await waitFor(() => {
      expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: terminalId });
      expect(within(screen.getByTestId(/terminal-/)).getByRole('textbox')).toHaveFocus();
    });
  });

  it('exposes pane and tab rename through the command palette', async () => {
    render(<App />);

    await screen.findByTestId(/terminal-/);
    await waitFor(() => {
      expect(rendererMocks.paletteActions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'rename-pane', shortcut: 'F2' }),
        expect.objectContaining({ id: 'rename-tab', shortcut: 'Ctrl+F2' }),
      ]));
    });

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'rename-pane')!.handler());
    expect(await screen.findByRole('dialog', { name: 'Rename terminal' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'rename-tab')!.handler());
    expect(await screen.findByRole('dialog', { name: 'Rename tab' })).toBeInTheDocument();
  });

  it('applies the command-palette close action to the focused pane', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split pane right/i });
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    const [firstTerminal, secondTerminal] = screen.getAllByTestId(/terminal-/);
    const firstId = firstTerminal.textContent!;
    const secondId = secondTerminal.textContent!;
    fireEvent.focus(secondTerminal);

    await waitFor(() => {
      expect(rendererMocks.paletteActions.find((action) => action.id === 'close-pane')).toBeTruthy();
    });
    act(() => {
      rendererMocks.paletteActions.find((action) => action.id === 'close-pane')!.handler();
    });
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    await confirmPendingAction(/^close pane$/i);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/).map((terminal) => terminal.textContent)).toEqual([firstId]);
    });
    expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: secondId });
  });

  it('opens terminal search from the command palette for the focused pane', async () => {
    const searchRequest = vi.fn();
    window.addEventListener('janet:terminal-search-request', searchRequest);

    try {
      render(<App />);
      await screen.findByRole('button', { name: /split pane right/i });
      fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));
      await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

      const focusedTerminal = screen.getAllByTestId(/terminal-/)[1];
      fireEvent.focus(focusedTerminal);
      await waitFor(() => {
        expect(rendererMocks.paletteActions.find((action) => action.id === 'search-toggle')).toBeTruthy();
      });

      act(() => {
        rendererMocks.paletteActions.find((action) => action.id === 'search-toggle')!.handler();
      });

      expect(searchRequest).toHaveBeenCalledTimes(1);
      expect((searchRequest.mock.calls[0][0] as CustomEvent).detail).toEqual({
        termId: focusedTerminal.textContent,
      });
    } finally {
      window.removeEventListener('janet:terminal-search-request', searchRequest);
    }
  });

  it('routes workspace view commands to their new layout owners', async () => {
    render(<App />);

    await screen.findByTestId('titlebar');
    await waitFor(() => {
      expect(rendererMocks.sidebarProps?.section).toBe('files');
      expect(rendererMocks.sidebarProps?.side).toBe('right');
      expect(rendererMocks.verticalTabBarProps?.sshConnectionsOpen).toBe(false);
      expect(rendererMocks.titlebarProps?.settingsOpen).toBe(false);
    });
    const appBody = document.querySelector('.app-body')!;
    expect(appBody).toHaveClass('sidebar-right');
    expect(appBody.firstElementChild).toBe(screen.getByTestId('vertical-tab-bar'));
    expect(appBody.lastElementChild).toBe(screen.getByTestId('sidebar'));

    act(() => {
      rendererMocks.paletteActions.find((action) => action.id === 'sidebar-git')!.handler();
    });
    await waitFor(() => {
      expect(rendererMocks.sidebarProps.section).toBe('git');
      expect(rendererMocks.sidebarProps.expanded).toBe(true);
    });

    act(() => {
      rendererMocks.sidebarProps.onExpandedChange(false);
      rendererMocks.paletteActions.find((action) => action.id === 'sidebar-files')!.handler();
    });
    await waitFor(() => {
      expect(rendererMocks.sidebarProps.section).toBe('files');
      expect(rendererMocks.sidebarProps.expanded).toBe(true);
    });

    act(() => {
      rendererMocks.paletteActions.find((action) => action.id === 'sidebar-ssh')!.handler();
    });
    await waitFor(() => {
      expect(rendererMocks.verticalTabBarProps.sshConnectionsOpen).toBe(true);
    });

    act(() => {
      rendererMocks.paletteActions.find((action) => action.id === 'settings-toggle')!.handler();
    });
    await waitFor(() => {
      expect(rendererMocks.titlebarProps.settingsOpen).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
    await waitFor(() => {
      expect(appBody).toHaveClass('sidebar-left');
      expect(rendererMocks.sidebarProps.side).toBe('left');
      expect(appBody.firstElementChild).toBe(screen.getByTestId('sidebar'));
      expect(window.janet.setSettings).toHaveBeenCalledWith({ sidebarSide: 'left' });
    });
  });

  it('moves focus to the persistent tool button before shortcut collapse hides its panel', async () => {
    render(<App />);

    const panelControl = await screen.findByRole('button', { name: 'Mock tool content' });
    panelControl.focus();
    expect(panelControl).toHaveFocus();

    act(() => {
      rendererMocks.paletteActions.find((action) => action.id === 'toggle-sidebar')!.handler();
    });

    await waitFor(() => {
      expect(rendererMocks.sidebarProps.expanded).toBe(false);
      expect(screen.queryByRole('button', { name: 'Mock tool content' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mock workspace tool' })).toHaveFocus();
    });
  });

  it('migrates a previously open SSH sidebar into the Tabs connection view', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [],
        sidebarOpen: true,
        tabsOpen: false,
        sidebarSection: 'ssh',
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(rendererMocks.sidebarProps?.expanded).toBe(false);
      expect(rendererMocks.verticalTabBarProps?.sshConnectionsOpen).toBe(true);
      expect(rendererMocks.titlebarProps?.settingsOpen).toBe(false);
    });
    expect(screen.getByTestId('vertical-tab-bar')).toBeInTheDocument();
  });

  it('migrates a previously open Settings sidebar into the titlebar popover', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [],
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'settings',
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(rendererMocks.sidebarProps?.expanded).toBe(false);
      expect(rendererMocks.titlebarProps?.settingsOpen).toBe(true);
      expect(rendererMocks.verticalTabBarProps?.sshConnectionsOpen).toBe(false);
    });
    expect(screen.getByRole('group', { name: 'Workspace tools position' })).toBeInTheDocument();
  });

  it('shows a recoverable startup state when settings cannot be loaded', async () => {
    window.janet.getSettings = vi.fn().mockRejectedValue(new Error('settings unavailable'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'JaneT could not load your workspace settings.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use defaults' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Use default settings?' });
    expect(screen.queryByTestId('titlebar')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not load');

    fireEvent.click(screen.getByRole('button', { name: 'Use defaults' }));
    await confirmPendingAction(/^use defaults$/i);
    expect(await screen.findByTestId('titlebar')).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId(/terminal-/)).getByRole('textbox')).toHaveFocus());
  });

  it('maximizes a single pane within the terminal area and restores it to the split layout', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split pane right/i });
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: /maximize pane/i })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: /maximize pane/i })[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: /restore pane layout/i })).toBeInTheDocument();
    });
    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /maximize pane/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /restore pane layout/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: /maximize pane/i })).toHaveLength(2);
    });
    expect(document.startViewTransition).toHaveBeenCalledTimes(2);
  });

  it('restores a maximized layout before focusing an existing worktree terminal', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const hiddenTerminalId = screen.getAllByTestId(/terminal-/)[1].getAttribute('data-terminal-id')!;

    fireEvent.click(screen.getAllByRole('button', { name: /maximize pane/i })[0]);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));

    act(() => rendererMocks.sidebarProps.onOpenTerminal(hiddenTerminalId));

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(within(screen.getByTestId(`terminal-${hiddenTerminalId}`)).getByRole('textbox')).toHaveFocus();
    });
  });

  it('clears maximized state if the maximized pane is closed', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split pane right/i });
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    fireEvent.click(screen.getAllByRole('button', { name: /maximize pane/i })[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: /restore pane layout/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /close (?:pane|terminal tab)/i }));
    await confirmPendingAction(/^close pane$/i);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /restore pane layout/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /maximize pane/i })).toBeNull();
  });

  it('resizes split panes from the keyboard', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    const divider = await screen.findByRole('separator', { name: 'Resize left and right panes' });
    expect(divider).toHaveAttribute('aria-valuenow', '50');

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    await waitFor(() => expect(divider).toHaveAttribute('aria-valuenow', '55'));
    fireEvent.keyDown(divider, { key: 'Home' });
    await waitFor(() => expect(divider).toHaveAttribute('aria-valuenow', '10'));
  });

  it('shows an untyped legacy split leaf with its inherited SSH fallback name', () => {
    render(
      <SplitPane
        node={{ id: 'legacy-ssh-leaf', type: 'leaf', title: 'terminal' }}
        tabId="legacy-ssh-tab"
        tabType="ssh"
        sshShellReady={false}
        onTerminalReady={vi.fn()}
        onTerminalRemoved={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={vi.fn()}
        onMovePane={vi.fn()}
        onPaneDragStart={vi.fn()}
        onPaneDragOver={vi.fn()}
        onPaneDragEnd={vi.fn()}
        onToggleMaximizePane={vi.fn()}
      />,
    );

    expect(screen.getByText('SSH')).toBeInTheDocument();
    expect(screen.getByLabelText('SSH — SSH pane')).toBeInTheDocument();
  });

  it('shows the current agent phase in the owning pane header', () => {
    const awareness: AgentAwareness = {
      provider: 'hermes', sessionId: 'session-1', phase: 'needs-input', phaseChangedAt: 10,
    };
    render(
      <SplitPane
        node={{ id: 'agent-leaf', type: 'leaf', title: 'terminal' }}
        tabId="agent-tab"
        tabType="local"
        awarenessByTerminal={{ 'agent-leaf': awareness }}
        onTerminalReady={vi.fn()}
        onTerminalRemoved={vi.fn()}
        onAgentEvent={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={vi.fn()}
        onMovePane={vi.fn()}
        onPaneDragStart={vi.fn()}
        onPaneDragOver={vi.fn()}
        onPaneDragEnd={vi.fn()}
        onToggleMaximizePane={vi.fn()}
      />,
    );

    expect(screen.getByText('Hermes · Needs input')).toHaveClass('leaf-awareness', 'needs-input');
  });

  it('cancels an active divider drag when the split unmounts', () => {
    const onResizePane = vi.fn();
    const { unmount } = render(
      <SplitPane
        node={{
          id: 'split-drag',
          type: 'split',
          direction: 'vertical',
          sizes: [1, 1],
          children: [
            { id: 'term-drag-a', type: 'leaf' },
            { id: 'term-drag-b', type: 'leaf' },
          ],
        }}
        tabId="tab-drag"
        tabType="local"
        onTerminalReady={vi.fn()}
        onTerminalRemoved={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={onResizePane}
        onMovePane={vi.fn()}
        onPaneDragStart={vi.fn()}
        onPaneDragOver={vi.fn()}
        onPaneDragEnd={vi.fn()}
        onToggleMaximizePane={vi.fn()}
      />,
    );
    const children = document.querySelectorAll<HTMLElement>('.split-child');
    for (const child of children) Object.defineProperty(child, 'offsetWidth', { configurable: true, value: 200 });

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 200 });
    expect(document.body.style.cursor).toBe('col-resize');
    unmount();
    fireEvent.mouseMove(document, { clientX: 250 });

    expect(onResizePane).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('auto-collapses tabs at compact widths and restores responsive collapses', async () => {
    const originalMatchMedia = window.matchMedia;
    let narrow = true;
    let listener: (() => void) | null = null;
    window.matchMedia = vi.fn(() => ({
      get matches() { return narrow; },
      media: '(max-width: 1000px)',
      onchange: null,
      addEventListener: (_event: string, next: () => void) => { listener = next; },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as any;
    try {
      render(<App />);
      expect(await screen.findByRole('button', { name: 'Show terminal tabs' })).toBeInTheDocument();

      narrow = false;
      act(() => listener?.());
      expect(await screen.findByTestId('vertical-tab-bar')).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('does not auto-open saved workspace presets at startup', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [{
        id: 'workspace-tab-1',
        name: 'JaneT repo',
        type: 'local',
        root: { type: 'leaf', terminalType: 'local', cwd: 'C:/Users/pckpr/projects/JaneT' },
        terminalCount: 1,
        splitDirection: 'vertical',
      }],
    });

    render(<App />);

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    expect(window.janet.terminalCreate).not.toHaveBeenCalledWith(expect.objectContaining({
      cwd: 'C:/Users/pckpr/projects/JaneT',
    }));
  });

  it('passes each preset pane startup sequence to its matching local or SSH backend', async () => {
    const sshProfileId = 'forge@box.local:22:password';
    const preset = {
      id: 'workspace-startup',
      name: 'Forge workspace',
      type: 'local' as const,
      root: {
        type: 'split' as const,
        direction: 'vertical' as const,
        sizes: [1, 1],
        children: [
          {
            type: 'leaf' as const,
            terminalType: 'local' as const,
            cwd: '/repo',
            startupCommands: ['npm install', 'npm run dev'],
          },
          {
            type: 'leaf' as const,
            terminalType: 'ssh' as const,
            sshProfileId,
            startupCommands: ['hermes doctor', 'hermes -p forge --tui'],
            startupShellDialect: 'posix' as const,
          },
        ],
      },
      terminalCount: 2,
      splitDirection: 'vertical' as const,
    };
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [preset],
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'forge',
        auth: 'password',
        password: 'secret',
      }],
    });

    render(<App />);

    await waitFor(() => {
      expect(rendererMocks.verticalTabBarProps?.onWorkspaceTabLaunch).toBeTypeOf('function');
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1);
    });
    (window.janet.terminalCreate as any).mockClear();
    (window.janet.sshCreateShell as any).mockClear();

    await act(async () => {
      await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
    });

    await waitFor(() => {
      expect(window.janet.terminalCreate).toHaveBeenCalledWith(expect.objectContaining({
        cwd: '/repo',
        startupCommands: ['npm install', 'npm run dev'],
      }));
      expect(window.janet.sshCreateShell).toHaveBeenCalledWith(expect.objectContaining({
        startupCommands: ['hermes doctor', 'hermes -p forge --tui'],
        startupShellDialect: 'posix',
      }));
    });
    expect(window.janet.terminalWrite).not.toHaveBeenCalled();
    expect(window.janet.sshWriteShell).not.toHaveBeenCalled();

    await waitFor(() => {
      const sessionUpdates = (window.janet.setSettings as any).mock.calls
        .map((call: any[]) => call[0])
        .filter((update: any) => Array.isArray(update?.session?.tabs));
      const savedTab = sessionUpdates.at(-1)?.session.tabs
        .find((candidate: { title: string }) => candidate.title === preset.name);
      expect(savedTab?.root.children[0].startupCommands).toEqual(['npm install', 'npm run dev']);
      expect(savedTab?.root.children[1]).toMatchObject({
        startupCommands: ['hermes doctor', 'hermes -p forge --tui'],
        startupShellDialect: 'posix',
      });
    }, { timeout: 1_500 });

    const launchedTab = rendererMocks.verticalTabBarProps.tabs.find(
      (tab: { workspaceId?: string }) => tab.workspaceId === preset.id,
    );
    expect(launchedTab).toBeTruthy();
    (window.janet.setSettings as any).mockClear();
    act(() => rendererMocks.verticalTabBarProps.onSaveWorkspaceTab(launchedTab));
    expect(window.janet.setSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Update preset “Forge workspace”?' })).toHaveTextContent(
      'Replace the saved preset with this tab’s current layout',
    );
    await confirmPendingAction(/^update preset$/i);
    await waitFor(() => {
      const workspaceUpdates = (window.janet.setSettings as any).mock.calls
        .map((call: any[]) => call[0])
        .filter((update: any) => Array.isArray(update?.workspaceTabs));
      const savedPreset = workspaceUpdates.at(-1)?.workspaceTabs
        .find((candidate: { id: string }) => candidate.id === preset.id);
      expect(savedPreset?.root.children[0].startupCommands).toEqual(['npm install', 'npm run dev']);
      expect(savedPreset?.root.children[1]).toMatchObject({
        startupCommands: ['hermes doctor', 'hermes -p forge --tui'],
        startupShellDialect: 'posix',
      });
    });
  });

  it('launches every terminal from a rootless legacy SSH preset', async () => {
    const sshProfileId = 'legacy@box.local:22:password';
    const preset = {
      id: 'legacy-remote-workspace',
      name: 'Legacy remote workspace',
      type: 'ssh' as const,
      sshProfileId,
      terminalCount: 2,
      splitDirection: 'horizontal' as const,
    };
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [preset],
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'legacy',
        auth: 'password',
        password: 'secret',
      }],
    });

    render(<App />);
    await waitFor(() => expect(rendererMocks.verticalTabBarProps?.onWorkspaceTabLaunch).toBeTypeOf('function'));
    const connectionCallStart = (window.janet.sshConnect as any).mock.calls.length;
    const shellCallStart = (window.janet.sshCreateShell as any).mock.calls.length;

    await act(async () => {
      await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
    });

    await waitFor(() => {
      const launchedTab = rendererMocks.verticalTabBarProps.tabs.find(
        (tab: { workspaceId?: string }) => tab.workspaceId === preset.id,
      );
      const sessionIds = launchedTab.root.children.map((leaf: { sshSessionId: string }) => leaf.sshSessionId);
      const connectionIds = (window.janet.sshConnect as any).mock.calls
        .slice(connectionCallStart).map((call: any[]) => call[0].id);
      const shellIds = (window.janet.sshCreateShell as any).mock.calls
        .slice(shellCallStart).map((call: any[]) => call[0].id);
      expect(sessionIds).toHaveLength(2);
      expect([...connectionIds].sort()).toEqual([...sessionIds].sort());
      expect([...shellIds].sort()).toEqual([...sessionIds].sort());
    });
    expect((window.janet.sshConnect as any).mock.calls.map((call: any[]) => call[0]))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ host: 'box.local', username: 'legacy' }),
        expect.objectContaining({ host: 'box.local', username: 'legacy' }),
      ]));
  });

  it('demotes a fresh preset SSH pane with a missing profile without running its commands locally', async () => {
    const preset = {
      id: 'missing-remote-workspace',
      name: 'Missing remote workspace',
      type: 'local' as const,
      terminalCount: 1,
      splitDirection: 'vertical' as const,
      root: {
        type: 'leaf' as const,
        terminalType: 'ssh' as const,
        sshProfileId: 'missing-profile',
        startupCommands: ['remote-only-command'],
        startupShellDialect: 'posix' as const,
      },
    };
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {}, workspaceTabs: [preset], sshProfiles: [],
    });

    render(<App />);
    await waitFor(() => expect(rendererMocks.verticalTabBarProps?.onWorkspaceTabLaunch).toBeTypeOf('function'));
    (window.janet.terminalCreate as any).mockClear();

    await act(async () => {
      await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
    });

    await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalled());
    expect(window.janet.sshConnect).not.toHaveBeenCalled();
    const localCreates = (window.janet.terminalCreate as any).mock.calls.map((call: any[]) => call[0]);
    expect(new Set(localCreates.map((call: { id: string }) => call.id)).size).toBe(1);
    for (const call of localCreates) {
      expect(call).not.toHaveProperty('startupCommands');
      expect(call).not.toHaveProperty('startupShellDialect');
    }
    const launched = rendererMocks.verticalTabBarProps.tabs.find(
      (tab: { workspaceId?: string }) => tab.workspaceId === preset.id,
    );
    expect(launched.root).toMatchObject({ terminalType: 'local' });
    expect(launched.root).not.toHaveProperty('startupCommands');
  });

  it('demotes a fresh preset SSH pane when its connection fails', async () => {
    const sshProfileId = 'offline@box.local:22:password';
    const preset = {
      id: 'offline-remote-workspace',
      name: 'Offline remote workspace',
      type: 'local' as const,
      terminalCount: 1,
      splitDirection: 'vertical' as const,
      root: {
        type: 'leaf' as const,
        terminalType: 'ssh' as const,
        sshProfileId,
        startupCommands: ['remote-only-command'],
        startupShellDialect: 'posix' as const,
      },
    };
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [preset],
      sshProfiles: [{
        id: sshProfileId, host: 'box.local', port: 22, username: 'offline',
        auth: 'password', password: 'secret',
      }],
    });
    (window.janet.sshConnect as any).mockRejectedValueOnce(new Error('offline'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      render(<App />);
      await waitFor(() => expect(rendererMocks.verticalTabBarProps?.onWorkspaceTabLaunch).toBeTypeOf('function'));
      await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalled());
      (window.janet.terminalCreate as any).mockClear();

      await act(async () => {
        await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
      });

      await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalled());
      expect(window.janet.sshCreateShell).not.toHaveBeenCalled();
      const localCreates = (window.janet.terminalCreate as any).mock.calls.map((call: any[]) => call[0]);
      expect(new Set(localCreates.map((call: { id: string }) => call.id)).size).toBe(1);
      for (const call of localCreates) expect(call).not.toHaveProperty('startupCommands');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('restores startup commands with a saved session and reruns them in fresh terminals', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [
          {
            id: 'tab-1',
            title: 'project',
            type: 'local',
            cwd: 'C:/repo',
            root: {
              type: 'split',
              direction: 'vertical',
              sizes: [1, 1],
              children: [
                {
                  type: 'leaf',
                  startupCommands: ['git pull', 'npm install'],
                  startupShellDialect: 'posix',
                },
                { type: 'leaf' },
              ],
            },
          },
          {
            id: 'tab-2',
            title: 'docs',
            type: 'local',
            root: { type: 'leaf' },
          },
        ],
        activeTabId: 'tab-1',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

    // Active tab is `project` (2-leaf split) — we should see 2 terminals
    // both created with the cwd saved in the session, proving the
    // restored tree (not the starter) is what's mounted.
    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      const projectCreates = (window.janet.terminalCreate as any).mock.calls.filter(
        (call: any[]) => call[0]?.cwd === 'C:/repo',
      );
      expect(projectCreates).toHaveLength(2);
      expect(projectCreates[0][0]).toMatchObject({
        startupCommands: ['git pull', 'npm install'],
        startupShellDialect: 'posix',
      });
      expect(projectCreates[1][0]).not.toHaveProperty('startupCommands');
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
    });
  });

  it('focuses the first terminal after clicking a terminal tab', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [
          {
            id: 'tab-1',
            title: 'project',
            type: 'local',
            root: {
              type: 'split',
              direction: 'vertical',
              sizes: [1, 1],
              children: [{ type: 'leaf' }, { type: 'leaf' }],
            },
          },
          {
            id: 'tab-2',
            title: 'docs',
            type: 'local',
            root: { type: 'leaf' },
          },
        ],
        activeTabId: 'tab-1',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    await openSampleEditor();

    fireEvent.click(within(screen.getByTestId('vertical-tab-bar')).getByText('docs'));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId('vertical-tab-bar')).getByText('project'));

    await waitFor(() => {
      const terminals = screen.getAllByTestId(/terminal-/);
      expect(terminals).toHaveLength(2);
      expect(within(terminals[0]).getByRole('textbox')).toHaveFocus();
    });
  });

  it('focuses the terminal when clicking the active outer tab from an editor surface', async () => {
    render(<App />);
    const editor = await openSampleEditor();
    editor.focus();
    expect(editor).toHaveFocus();

    const activeTabId = rendererMocks.verticalTabBarProps.activeTabId as string;
    fireEvent.click(screen.getByTestId(`outer-tab-${activeTabId}`));

    const terminal = screen.getByTestId(/terminal-/);
    await waitFor(() => expect(within(terminal).getByRole('textbox')).toHaveFocus());
  });

  it('focuses an existing worktree terminal without creating another tab', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [
          { id: 'tab-1', title: 'main', type: 'local', cwd: 'C:/repo', root: { type: 'leaf', cwd: 'C:/repo' } },
          { id: 'tab-2', title: 'cleanup', type: 'local', cwd: 'C:/worktrees/cleanup', root: { type: 'leaf', cwd: 'C:/worktrees/cleanup' } },
        ],
        activeTabId: 'tab-1',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'git',
      },
    });
    render(<App />);
    await waitFor(() => expect(rendererMocks.sidebarProps.openLocalTerminals).toHaveLength(2));
    expect(within(screen.getByTestId('vertical-tab-bar')).getByText('main')).toBeInTheDocument();
    expect(window.janet.terminalCreate).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Focus last open terminal' }));

    await waitFor(() => {
      const cleanupTab = rendererMocks.verticalTabBarProps.tabs.find((tab: { title: string }) => tab.title === 'cleanup');
      expect(rendererMocks.verticalTabBarProps.activeTabId).toBe(cleanupTab.id);
      expect(within(screen.getByTestId(/terminal-/)).getByRole('textbox')).toHaveFocus();
    });
    expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
    expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2);
  });

  it('describes the terminal and cwd driving workspace tools', async () => {
    render(<App />);

    await waitFor(() => expect(rendererMocks.sidebarProps.followingTarget).toEqual({
      label: 'Terminal',
      path: '/home/test',
    }));
  });

  it('does not create an unsaveable terminal tab beyond the session budget', async () => {
    const tabs = new Array(64).fill(null).map((_, index) => ({
      id: `saved-${index}`, title: `Saved ${index}`, type: 'local', root: { type: 'leaf' },
    }));
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs, activeTabId: tabs[0].id, sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    });

    render(<App />);
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(64));
    act(() => rendererMocks.verticalTabBarProps.onNewTab());

    expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(64);
  });

  it('does not split a pane beyond the shared terminal budget', async () => {
    const tabs = new Array(64).fill(null).map((_, index) => ({
      id: `saved-${index}`, title: `Saved ${index}`, type: 'local', root: { type: 'leaf' },
    }));
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs, activeTabId: tabs[0].id, sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    });

    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));

    expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
  });

  it('restores a saved SSH tab, connects it, then binds a single shell', async () => {
    const sessionUuid = '7f81f492-7008-4e40-b558-1c0ca27d1b46';
    const randomUuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(sessionUuid);
    const sshProfileId = 'pckpr@box.local:22:password';
    const profile = {
      id: sshProfileId,
      host: 'box.local',
      port: 22,
      username: 'pckpr',
      auth: 'password' as const,
      password: 'secret',
    };
    let resolveConnect: ((value?: unknown) => void) | undefined;
    let connectResolved = false;
    window.janet.sshConnect = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveConnect = (value?: unknown) => {
        connectResolved = true;
        resolve(value);
      };
    }));
    window.janet.sshCreateShell = vi.fn().mockImplementation(() => {
      expect(connectResolved).toBe(true);
      return Promise.resolve({ connected: true });
    });
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      sshProfiles: [profile],
      session: {
        tabs: [
          {
            id: 'ssh-1',
            title: 'box',
            type: 'ssh',
            sshProfileId,
            root: {
              type: 'leaf',
              startupCommands: ['hermes doctor', 'hermes --tui'],
              startupShellDialect: 'posix',
            },
          },
        ],
        activeTabId: 'ssh-1',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

    // The SSH tab should mount a single terminal...
    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });

    // The xterm mounts first, but shell creation waits until the SSH
    // transport exists. Otherwise restored panes race ssh:createShell
    // against ssh:connect and can fail with "session not found".
    await waitFor(() => expect(window.janet.sshConnect).toHaveBeenCalledTimes(1));
    const pendingSessionId = (window.janet.sshConnect as any).mock.calls[0][0].id as string;
    expect(randomUuid).toHaveBeenCalledOnce();
    expect(pendingSessionId).toBe(`ssh-${sessionUuid}`);
    randomUuid.mockRestore();
    expect(rendererMocks.sidebarProps.explorerSource).toEqual(expect.objectContaining({
      kind: 'ssh',
      sessionId: pendingSessionId,
      label: 'pckpr@box.local:22',
      connectionState: 'connecting',
      ready: false,
    }));
    expect(rendererMocks.sidebarProps.explorerSource).not.toHaveProperty('cwd', '/home/test');

    resolveConnect?.({ connected: true });

    await waitFor(() => {
      expect(window.janet.sshCreateShell).toHaveBeenCalledTimes(1);
    });

    const connectArgs = (window.janet.sshConnect as any).mock.calls[0][0] as any;
    const shellArgs = (window.janet.sshCreateShell as any).mock.calls[0][0] as any;
    expect(connectArgs.id).toBe(`ssh-${sessionUuid}`);
    expect(shellArgs.id).toBe(connectArgs.id);
    expect(shellArgs).toMatchObject({
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'posix',
    });
    expect(rendererMocks.sidebarProps.explorerSource).toEqual(expect.objectContaining({
      kind: 'ssh',
      sessionId: connectArgs.id,
      connectionState: 'ready',
      ready: true,
    }));

    act(() => {
      rendererMocks.verticalTabBarProps.onSSHProfilesChange([{ ...profile, host: 'renamed-box.local' }]);
    });
    await waitFor(() => {
      expect(rendererMocks.verticalTabBarProps.sshProfiles[0].host).toBe('renamed-box.local');
    });
    expect(window.janet.sshConnect).toHaveBeenCalledTimes(1);

    act(() => {
      rendererMocks.sshConnectionClosedHandler?.({ id: connectArgs.id, reason: 'transport reset' });
    });
    await waitFor(() => {
      expect(rendererMocks.sidebarProps.explorerSource).toEqual(expect.objectContaining({
        kind: 'ssh',
        sessionId: connectArgs.id,
        connectionState: 'disconnected',
        ready: false,
      }));
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '0');
    });
    expect(screen.getByTestId(`terminal-${shellArgs.termId}`)).toHaveAttribute(
      'data-ssh-connection-lost',
      'true',
    );
    expect(rendererMocks.verticalTabBarProps.awarenessByTab[
      rendererMocks.verticalTabBarProps.activeTabId
    ])
      .toEqual({ kind: 'disconnected', label: 'SSH disconnected' });
    expect(screen.getByText('SSH disconnected')).toHaveClass('leaf-awareness', 'disconnected');
    expect(window.janet.sshConnect).toHaveBeenCalledTimes(1);

    const retry = rendererMocks.sshRetryHandlers.get(shellArgs.termId);
    expect(retry).toBeTruthy();
    (window.janet.sshCreateShell as any).mockRejectedValueOnce(new Error('session not found'));
    (window.janet.sshConnect as any)
      .mockRejectedValueOnce(new Error('host offline'))
      .mockResolvedValue({ connected: true });

    await act(async () => {
      await expect(Promise.resolve(retry?.(shellArgs.termId, { cols: 120, rows: 40 })))
        .rejects.toThrow('host offline');
    });
    expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    expect(rendererMocks.sidebarProps.explorerSource).toEqual(expect.objectContaining({
      connectionState: 'disconnected',
      ready: false,
    }));

    (window.janet.sshCreateShell as any).mockRejectedValueOnce(new Error('session not found'));
    await act(async () => {
      await retry?.(shellArgs.termId, { cols: 120, rows: 40 });
    });
    await waitFor(() => {
      expect(window.janet.sshCreateShell).toHaveBeenCalledTimes(4);
      expect(window.janet.sshConnect).toHaveBeenCalledTimes(3);
      expect(rendererMocks.sidebarProps.explorerSource).toEqual(expect.objectContaining({
        connectionState: 'ready',
        ready: true,
      }));
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '1');
    });
  });

  it('demotes a restored SSH tab with a missing profile to a working local shell', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      sshProfiles: [],
      session: {
        tabs: [{
          id: 'missing-ssh',
          title: 'removed host',
          type: 'ssh',
          sshProfileId: 'removed-profile',
          root: {
            type: 'leaf',
            terminalType: 'ssh',
            sshProfileId: 'removed-profile',
            startupCommands: ['rm -rf remote-build'],
            startupShellDialect: 'posix',
          },
        }],
        activeTabId: 'missing-ssh',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

    await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1));
    const localCreate = (window.janet.terminalCreate as any).mock.calls[0][0];
    expect(localCreate).not.toHaveProperty('startupCommands');
    expect(localCreate).not.toHaveProperty('startupShellDialect');
    expect(window.janet.sshConnect).not.toHaveBeenCalled();
    expect(window.janet.sshCreateShell).not.toHaveBeenCalled();
  });

  it('demotes only a restored workspace SSH leaf whose profile is missing', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      sshProfiles: [],
      session: {
        tabs: [{
          id: 'mixed-workspace',
          title: 'mixed',
          type: 'local',
          root: {
            type: 'split',
            direction: 'vertical',
            sizes: [1, 1],
            children: [
              { type: 'leaf', terminalType: 'local' },
              { type: 'leaf', terminalType: 'ssh', sshProfileId: 'removed-profile' },
            ],
          },
        }],
        activeTabId: 'mixed-workspace',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      const createdIds = (window.janet.terminalCreate as any).mock.calls.map(
        (call: any[]) => call[0]?.id,
      );
      expect(new Set(createdIds).size).toBe(2);
    });
    expect(window.janet.sshConnect).not.toHaveBeenCalled();
    expect(window.janet.sshCreateShell).not.toHaveBeenCalled();
  });

  it('retries a mixed-workspace SSH leaf with measured dimensions and surfaces transport failure', async () => {
    const sshProfileId = 'mixed@box.local:22:password';
    const preset = {
      id: 'mixed-workspace-retry',
      name: 'mixed retry',
      type: 'local' as const,
      terminalCount: 2,
      splitDirection: 'vertical' as const,
      root: {
        type: 'split' as const,
        direction: 'vertical' as const,
        sizes: [1, 1],
        children: [
          { type: 'leaf' as const, terminalType: 'local' as const },
          {
            type: 'leaf' as const,
            terminalType: 'ssh' as const,
            sshProfileId,
            startupCommands: ['hermes doctor', 'hermes --tui'],
            startupShellDialect: 'posix' as const,
          },
        ],
      },
    };
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [preset],
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'mixed',
        auth: 'password',
        password: 'secret',
      }],
    });

    render(<App />);

    await waitFor(() => expect(rendererMocks.verticalTabBarProps?.onWorkspaceTabLaunch).toBeTypeOf('function'));
    await act(async () => {
      await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
    });

    await waitFor(() => expect(window.janet.sshCreateShell).toHaveBeenCalledTimes(1));
    const initialShell = (window.janet.sshCreateShell as any).mock.calls[0][0];
    const retry = rendererMocks.sshRetryHandlers.get(initialShell.termId);
    expect(retry).toBeTruthy();

    (window.janet.sshCreateShell as any).mockClear();
    (window.janet.sshConnect as any).mockClear();
    (window.janet.sshCreateShell as any)
      .mockRejectedValueOnce(new Error('stale shell'))
      .mockResolvedValueOnce({ connected: true });

    await act(async () => {
      await retry!(initialShell.termId, { cols: 132, rows: 48 });
    });

    expect(window.janet.sshConnect).toHaveBeenCalledWith(expect.objectContaining({
      id: initialShell.id,
      host: 'box.local',
      username: 'mixed',
    }));
    expect(window.janet.sshCreateShell).toHaveBeenNthCalledWith(1, {
      id: initialShell.id,
      termId: initialShell.termId,
      cols: 132,
      rows: 48,
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'posix',
    });
    expect(window.janet.sshCreateShell).toHaveBeenNthCalledWith(2, {
      id: initialShell.id,
      termId: initialShell.termId,
      cols: 132,
      rows: 48,
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'posix',
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      (window.janet.sshCreateShell as any).mockRejectedValueOnce(new Error('shell unavailable'));
      (window.janet.sshConnect as any).mockRejectedValueOnce(new Error('transport unavailable'));
      await expect(retry!(initialShell.termId, { cols: 132, rows: 48 }))
        .rejects.toThrow('transport unavailable');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('releases an SSH connection that finishes after its owning tab closes', async () => {
    const sshProfileId = 'pending@box.local:22:password';
    let resolveConnect!: (value: unknown) => void;
    window.janet.sshConnect = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveConnect = resolve;
    }));
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'pending',
        auth: 'password',
        password: 'secret',
      }],
      session: {
        tabs: [{
          id: 'pending-ssh',
          title: 'pending box',
          type: 'ssh',
          sshProfileId,
          root: { type: 'leaf' },
        }],
        activeTabId: 'pending-ssh',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);
    await waitFor(() => {
      expect(window.janet.sshConnect).toHaveBeenCalledTimes(1);
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });
    const sessionId = (window.janet.sshConnect as any).mock.calls[0][0].id as string;

    fireEvent.click(screen.getByRole('button', { name: /close (?:pane|terminal tab)/i }));
    expect(window.janet.sshDisconnect).not.toHaveBeenCalled();
    await confirmPendingAction(/^close tab$/i);
    await waitFor(() => {
      expect(window.janet.sshDisconnect).toHaveBeenCalledWith({ id: sessionId });
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '0');
    });

    await act(async () => {
      resolveConnect({ connected: true });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(window.janet.sshDisconnect).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '0');
    });
    expect(window.janet.sshCreateShell).not.toHaveBeenCalled();
  });

  it('destroys individual SSH shells, disconnects released sessions, and disposes cached terminals', async () => {
    const sshProfileId = 'test@box.local:22:password';
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'test',
        auth: 'password',
        password: 'secret',
      }],
      session: {
        tabs: [{
          id: 'ssh-split',
          title: 'box',
          type: 'ssh',
          sshProfileId,
          root: {
            type: 'split',
            direction: 'vertical',
            sizes: [1, 1],
            children: [{ type: 'leaf' }, { type: 'leaf' }],
          },
        }],
        activeTabId: 'ssh-split',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(window.janet.sshCreateShell).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '1');
    });

    const sessionId = (window.janet.sshConnect as any).mock.calls[0][0].id as string;
    const secondId = screen.getAllByTestId(/terminal-/)[1].textContent!;
    fireEvent.click(screen.getAllByRole('button', { name: /close (?:pane|terminal tab)/i })[1]);
    expect(window.janet.sshDestroyShell).not.toHaveBeenCalled();
    await confirmPendingAction(/^close pane$/i);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
      expect(window.janet.sshDestroyShell).toHaveBeenCalledWith({ sessionId, termId: secondId });
      expect(rendererMocks.disposeCachedTerminal).toHaveBeenCalledWith(secondId);
    });
    expect(window.janet.sshDisconnect).not.toHaveBeenCalled();

    const remainingId = screen.getByTestId(/terminal-/).textContent!;
    fireEvent.click(screen.getByRole('button', { name: /close (?:pane|terminal tab)/i }));
    expect(window.janet.sshDisconnect).not.toHaveBeenCalled();
    await confirmPendingAction(/^close tab$/i);

    await waitFor(() => {
      expect(window.janet.sshDisconnect).toHaveBeenCalledWith({ id: sessionId });
      expect(rendererMocks.disposeCachedTerminal).toHaveBeenCalledWith(remainingId);
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '0');
    });
  });

  it('persists the open tabs to settings after a tab change', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({ keybindings: {}, workspaceTabs: [] });
    window.janet.setSettings = vi.fn().mockResolvedValue(undefined);

    render(<App />);

    // Wait for the initial terminal to mount.
    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });

    // Split right — adds a leaf to the active tab.
    fireEvent.click(screen.getByRole('button', { name: /split pane right/i }));

    // Wait past the 500ms debounce window for the save to flush.
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));

    const calls = (window.janet.setSettings as any).mock.calls as Array<[any]>;
    const sessionCalls = calls.filter(([arg]) => arg && Object.prototype.hasOwnProperty.call(arg, 'session'));
    expect(sessionCalls.length).toBeGreaterThan(0);
    const lastSession = sessionCalls.at(-1)![0].session as any;
    expect(Array.isArray(lastSession.tabs)).toBe(true);
    expect(lastSession.tabs.length).toBeGreaterThan(0);
    // The active tab was split — root should now be a split, not a leaf.
    expect(lastSession.tabs[0].root.type).toBe('split');
  }, 5000);
});

describe('editor documents in the app', () => {
  it('opens a local file from the sidebar and marks its terminal tab dirty after editing', async () => {
    render(<App />);

    const editor = await openSampleEditor();
    expect(editor).toHaveValue('export const answer = 42;\n');
    expect(screen.getByRole('tab', { name: 'sample.ts' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(editor, { target: { value: 'export const answer = 43;\n' } });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /sample\.ts, unsaved changes/i })).toBeInTheDocument();
      const tabId = rendererMocks.verticalTabBarProps.tabs[0].id;
      expect(screen.getByTestId(`outer-tab-${tabId}`)).toHaveAttribute('data-dirty', 'true');
      expect(rendererMocks.verticalTabBarProps.dirtyTabIds.has(tabId)).toBe(true);
    });
  });

  it.each(['shortcut', 'palette'] as const)(
    'focuses the previous document after closing the active document from the %s',
    async (route) => {
      if (route === 'shortcut') {
        window.janet.getSettings = vi.fn().mockResolvedValue({
          keybindings: { 'close-document': 'Ctrl+Alt+D' },
          workspaceTabs: [],
          notificationsEnabled: false,
          notificationThresholdSeconds: 10,
        });
      }
      render(<App />);

      await openSampleEditor();
      act(() => rendererMocks.sidebarProps.onOpenFile({ kind: 'local', path: '/home/test/second.ts' }));
      const secondEditor = await screen.findByRole('textbox', { name: 'Editing second.ts' });
      secondEditor.focus();

      if (route === 'shortcut') {
        fireEvent.keyDown(document, { key: 'd', ctrlKey: true, altKey: true });
      } else {
        act(() => rendererMocks.paletteActions.find((action) => action.id === 'close-document')!.handler());
      }

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: 'second.ts' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'sample.ts' })).toHaveFocus();
      });
    },
  );

  it.each(['shortcut', 'palette', 'close button'] as const)(
    'focuses the next document after closing the first document from the %s',
    async (route) => {
      if (route === 'shortcut') {
        window.janet.getSettings = vi.fn().mockResolvedValue({
          keybindings: { 'close-document': 'Ctrl+Alt+D' },
          workspaceTabs: [],
          notificationsEnabled: false,
          notificationThresholdSeconds: 10,
        });
      }
      render(<App />);

      await openSampleEditor();
      act(() => rendererMocks.sidebarProps.onOpenFile({ kind: 'local', path: '/home/test/second.ts' }));
      await screen.findByRole('textbox', { name: 'Editing second.ts' });
      fireEvent.click(screen.getByRole('tab', { name: 'sample.ts' }));

      if (route === 'shortcut') {
        fireEvent.keyDown(document, { key: 'd', ctrlKey: true, altKey: true });
      } else if (route === 'palette') {
        act(() => rendererMocks.paletteActions.find((action) => action.id === 'close-document')!.handler());
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Close sample.ts' }));
      }

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: 'sample.ts' })).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'second.ts' })).toHaveFocus();
      });
    },
  );

  it.each(['shortcut', 'palette'] as const)(
    'focuses the terminal after closing the only document from the %s',
    async (route) => {
      if (route === 'shortcut') {
        window.janet.getSettings = vi.fn().mockResolvedValue({
          keybindings: { 'close-document': 'Ctrl+Alt+D' },
          workspaceTabs: [],
          notificationsEnabled: false,
          notificationThresholdSeconds: 10,
        });
      }
      render(<App />);

      const editor = await openSampleEditor();
      editor.focus();

      if (route === 'shortcut') {
        fireEvent.keyDown(document, { key: 'd', ctrlKey: true, altKey: true });
      } else {
        act(() => rendererMocks.paletteActions.find((action) => action.id === 'close-document')!.handler());
      }

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: 'sample.ts' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /^Terminal / })).toHaveFocus();
      });
    },
  );

  it.each(["Don't Save", 'Save'] as const)(
    'restores focus after Cancel and focuses the terminal after shortcut %s closes the only dirty document',
    async (closeAction) => {
      window.janet.getSettings = vi.fn().mockResolvedValue({
        keybindings: { 'close-document': 'Ctrl+Alt+D' },
        workspaceTabs: [],
        notificationsEnabled: false,
        notificationThresholdSeconds: 10,
      });
      render(<App />);

      const editor = await openSampleEditor();
      fireEvent.change(editor, { target: { value: 'changed\n' } });
      editor.focus();
      fireEvent.keyDown(document, { key: 'd', ctrlKey: true, altKey: true });

      let dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(editor).toHaveFocus());

      fireEvent.keyDown(document, { key: 'd', ctrlKey: true, altKey: true });
      dialog = await screen.findByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: closeAction }));

      await waitFor(() => {
        expect(screen.queryByRole('tab', { name: /sample\.ts/i })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /^Terminal / })).toHaveFocus();
      });
      expect(window.janet.fsWriteTextFile).toHaveBeenCalledTimes(closeAction === 'Save' ? 1 : 0);
    },
  );

  it("keeps a dirty file open on Cancel and closes it on Don't Save", async () => {
    render(<App />);

    const editor = await openSampleEditor();
    fireEvent.change(editor, { target: { value: 'discard me\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close sample.ts' }));

    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Save changes to sample.ts?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('textbox', { name: 'Editing sample.ts' })).toHaveValue('discard me\n');
    expect(window.janet.fsWriteTextFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close sample.ts' }));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: "Don't Save" }));

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: /sample\.ts/i })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /^Terminal / })).toHaveFocus();
    });
    expect(window.janet.fsWriteTextFile).not.toHaveBeenCalled();
  });

  it('saves a dirty file before closing it when Save is chosen', async () => {
    render(<App />);

    const editor = await openSampleEditor();
    fireEvent.change(editor, { target: { value: 'export const saved = true;\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close sample.ts' }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(window.janet.fsWriteTextFile).toHaveBeenCalledWith(expect.objectContaining({
        requestedPath: '/home/test/sample.ts',
        resolvedPath: '/home/test/sample.ts',
        content: 'export const saved = true;\n',
      }));
      expect(screen.queryByRole('tab', { name: /sample\.ts/i })).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: /^Terminal / })).toHaveFocus();
    });
  });

  it('keeps a dirty terminal workspace on Cancel and tears it down on explicit discard', async () => {
    render(<App />);

    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.textContent!;
    const editor = await openSampleEditor();
    fireEvent.change(editor, { target: { value: 'unsaved workspace change\n' } });
    const tabId = rendererMocks.verticalTabBarProps.tabs[0].id;

    act(() => rendererMocks.verticalTabBarProps.onCloseTab(tabId));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Discard and close' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('textbox', { name: 'Editing sample.ts' })).toHaveValue('unsaved workspace change\n');
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    expect(rendererMocks.verticalTabBarProps.tabs.some((tab: { id: string }) => tab.id === tabId)).toBe(true);

    act(() => rendererMocks.verticalTabBarProps.onCloseTab(tabId));
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard and close' }));

    await waitFor(() => {
      expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: terminalId });
      expect(screen.queryByRole('tab', { name: /sample\.ts/i })).not.toBeInTheDocument();
      expect(rendererMocks.verticalTabBarProps.tabs.some((tab: { id: string }) => tab.id === tabId)).toBe(false);
    });
    expect(window.janet.fsWriteTextFile).not.toHaveBeenCalled();
  });
});

describe('unsaved editor shutdown handshake', () => {
  it('persists the latest terminal layout before acknowledging a clean close', async () => {
    const events: string[] = [];
    vi.mocked(window.janet.setSettings).mockImplementation(async (updates) => {
      if ('session' in updates) events.push('session');
      return undefined;
    });
    vi.mocked(window.janet.resolvePrepareForClose).mockImplementation(async () => {
      events.push('resolved');
      return true;
    });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /split pane right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    events.length = 0;

    await requestWorkspaceClose('layout-close', 'application-quit');

    expect(window.janet.setSettings).toHaveBeenCalledWith({
      session: expect.objectContaining({
        tabs: [expect.objectContaining({
          root: expect.objectContaining({
            type: 'split',
            children: [expect.any(Object), expect.any(Object)],
          }),
        })],
      }),
    });
    expect(events).toEqual(['session', 'resolved']);
  });

  it('persists a cwd reported in the same batch as close preparation', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.getAttribute('data-terminal-id')!;
    const latestCwd = 'C:/repo/latest';

    await act(async () => {
      rendererMocks.cwdChangeHandlers.get(terminalId)!(terminalId, latestCwd);
      await rendererMocks.prepareForCloseHandler!({
        requestId: 'cwd-close',
        reason: 'application-quit',
      });
    });

    expect(window.janet.setSettings).toHaveBeenCalledWith({
      session: expect.objectContaining({
        tabs: [expect.objectContaining({
          root: expect.objectContaining({
            children: [expect.objectContaining({ cwd: latestCwd })],
          }),
        })],
      }),
    });
  });

  it('persists a tab rename reported in the same batch as close preparation', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const terminalInput = within(terminal).getByRole('textbox');
    act(() => terminalInput.focus());
    fireEvent.keyDown(terminalInput, { key: 'F2', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Rename tab' });
    const nameInput = within(dialog).getByRole('textbox', { name: 'Tab name' });
    fireEvent.change(nameInput, { target: { value: 'Latest workspace' } });

    await act(async () => {
      fireEvent.keyDown(nameInput, { key: 'Enter' });
      await rendererMocks.prepareForCloseHandler!({
        requestId: 'rename-close',
        reason: 'application-quit',
      });
    });

    expect(window.janet.setSettings).toHaveBeenCalledWith({
      session: expect.objectContaining({
        tabs: [expect.objectContaining({ title: 'Latest workspace' })],
      }),
    });
  });

  it('resolves close preparation as saved immediately when no file is dirty', async () => {
    render(<App />);

    await requestWorkspaceClose('clean-close', 'application-quit');

    await waitFor(() => {
      expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
        requestId: 'clean-close',
        resolution: 'saved',
      });
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('cancels clean, discard, and save-all shutdown when final session persistence fails', async () => {
    vi.mocked(window.janet.setSettings).mockRejectedValue(new Error('disk full'));
    render(<App />);

    await requestWorkspaceClose('failed-clean-close', 'application-quit');
    expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
      requestId: 'failed-clean-close', resolution: 'cancel',
    });

    const editor = await openSampleEditor();
    fireEvent.change(editor, { target: { value: 'dirty during failed shutdown\n' } });

    await requestWorkspaceClose('failed-discard-close', 'window-close');
    let dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes and close' }));
    await waitFor(() => expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
      requestId: 'failed-discard-close', resolution: 'cancel',
    }));

    await requestWorkspaceClose('failed-save-close', 'update-install');
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save all and close' }));
    await waitFor(() => {
      expect(window.janet.fsWriteTextFile).toHaveBeenCalledWith(expect.objectContaining({
        content: 'dirty during failed shutdown\n',
      }));
      expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
        requestId: 'failed-save-close', resolution: 'cancel',
      });
    });
  });

  it('resolves one shutdown request once under same-batch confirmation', async () => {
    let releasePersist!: () => void;
    vi.mocked(window.janet.setSettings).mockReturnValue(new Promise((resolve) => {
      releasePersist = () => resolve(undefined);
    }));
    render(<App />);

    const editor = await openSampleEditor();
    fireEvent.change(editor, { target: { value: 'dirty during duplicate confirmation\n' } });
    await requestWorkspaceClose('single-resolution-close', 'application-quit');
    const dialog = await screen.findByRole('alertdialog');
    const discard = within(dialog).getByRole('button', { name: 'Discard changes and close' });
    vi.mocked(window.janet.setSettings).mockClear();

    act(() => {
      fireEvent.click(discard);
      fireEvent.click(discard);
    });

    expect(window.janet.setSettings).toHaveBeenCalledTimes(1);
    releasePersist();
    await waitFor(() => expect(window.janet.resolvePrepareForClose).toHaveBeenCalledTimes(1));
    expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
      requestId: 'single-resolution-close', resolution: 'discarded',
    });
  });

  it('offers Cancel, Discard, and Save all for dirty files and reports each resolution', async () => {
    render(<App />);

    const editor = await openSampleEditor();
    fireEvent.change(editor, { target: { value: 'dirty during shutdown\n' } });
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /sample\.ts, unsaved changes/i })).toBeInTheDocument();
    });

    await requestWorkspaceClose('cancel-close', 'window-close');
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Save all and close' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Discard changes and close' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
        requestId: 'cancel-close',
        resolution: 'cancel',
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    await requestWorkspaceClose('discard-close', 'application-quit');
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes and close' }));
    await waitFor(() => {
      expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
        requestId: 'discard-close',
        resolution: 'discarded',
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(window.janet.fsWriteTextFile).not.toHaveBeenCalled();

    await requestWorkspaceClose('save-close', 'update-install');
    dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save all and close' }));
    await waitFor(() => {
      expect(window.janet.fsWriteTextFile).toHaveBeenCalledWith(expect.objectContaining({
        content: 'dirty during shutdown\n',
      }));
      expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
        requestId: 'save-close',
        resolution: 'saved',
      });
    });
  });
});
