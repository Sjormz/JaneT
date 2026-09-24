import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/renderer/App';
import SplitPane from '../../src/renderer/components/SplitPane';
import type { AgentAwareness } from '../../src/renderer/terminalAwareness';
import type { AgentLifecycleEvent } from '../../src/renderer/terminalAwareness';
import type { SemanticCommandEvent, SemanticCommandStartedEvent } from '../../src/renderer/semanticCommands';

async function splitFromPalette(id = 'split-right') {
  await waitFor(() => expect(rendererMocks.paletteActions.find(action => action.id === id)).toBeDefined());
  act(() => rendererMocks.paletteActions.find(action => action.id === id)!.handler());
}
const mountedTermIds: string[] = [];
const readyTermIds: string[] = [];
const rendererMocks = vi.hoisted(() => ({
  disposeCachedTerminal: vi.fn(),
  awaitLocalCreate: false,
  paletteActions: [] as Array<{
    id: string;
    label: string;
    category: string;
    keywords?: readonly string[];
    shortcut?: string;
    handler: () => void;
  }>,
  titlebarProps: null as any,
  shortcutEditorProps: null as any,
  sidebarProps: null as any,
  verticalTabBarProps: null as any,
  prepareForCloseHandler: null as null | ((request: {
    requestId: string;
    reason: 'window-close' | 'application-quit' | 'update-install';
  }) => void | Promise<void>),
  terminalExitHandler: null as null | ((event: { id: string; exitCode: number; signal: number }) => void),
  cwdChangeHandlers: new Map<string, (termId: string, cwd: string) => void>(),
  agentEventHandlers: new Map<string, (event: AgentLifecycleEvent) => void>(),
  semanticCommandStartedHandlers: new Map<string, (event: SemanticCommandStartedEvent) => void>(),
  semanticCommandCancelledHandlers: new Map<string, (event: SemanticCommandStartedEvent) => void>(),
  semanticCommandHandlers: new Map<string, (event: SemanticCommandEvent) => void>(),
  broadcastInputHandlers: new Map<string, (data: string, binary?: boolean) => boolean>(),
  inputLabels: new Map<string, string>(),
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
vi.mock('../../src/renderer/components/StatusBar', () => ({ default: () => <div data-testid="statusbar" /> }));
vi.mock('../../src/renderer/components/CommandPalette', () => ({
  default: ({ actions }: { actions: Array<{
    id: string;
    label: string;
    category: string;
    keywords?: readonly string[];
    shortcut?: string;
    handler: () => void;
  }> }) => {
    React.useLayoutEffect(() => {
      rendererMocks.paletteActions = actions;
    }, [actions]);
    return (
      <div data-testid="command-palette-actions">
        {actions.map((action) => (
          <div
            key={action.id}
            data-testid={`command-palette-action-${action.id}`}
            onClick={action.handler}
          />
        ))}
      </div>
    );
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
    startupCommands,
    startupShellDialect,
    onReady,
    onRemoved,
    onCwdChange,
    onFocus,
    onAgentEvent,
    onSemanticCommandStarted,
    onSemanticCommandCancelled,
    onSemanticCommand,
    onBroadcastInput,
    inputLabel,
  }: {
    termId: string;
    hasSession?: boolean;
    initialCwd?: string;
    tabType?: 'local';
    startupCommands?: string[];
    startupShellDialect?: 'posix' | 'fish' | 'powershell';
    onReady?: (id: string) => void;
    onRemoved?: (id: string) => void;
    onCwdChange?: (id: string, cwd: string) => void;
    onFocus?: (id: string) => void;
    onAgentEvent?: (termId: string, event: AgentLifecycleEvent) => void;
    onSemanticCommandStarted?: (termId: string, event: SemanticCommandStartedEvent) => void;
    onSemanticCommandCancelled?: (termId: string, event: SemanticCommandStartedEvent) => void;
    onSemanticCommand?: (termId: string, event: SemanticCommandEvent) => void;
    onBroadcastInput?: (termId: string, data: string, binary?: boolean) => boolean;
    inputLabel?: string;
  }) {
    let effectActive = true;
    if (onCwdChange) rendererMocks.cwdChangeHandlers.set(termId, onCwdChange);
    if (onAgentEvent) rendererMocks.agentEventHandlers.set(termId, (event) => onAgentEvent(termId, event));
    if (onSemanticCommandStarted) rendererMocks.semanticCommandStartedHandlers.set(termId, (event) => onSemanticCommandStarted(termId, event));
    if (onSemanticCommandCancelled) rendererMocks.semanticCommandCancelledHandlers.set(termId, (event) => onSemanticCommandCancelled(termId, event));
    if (onSemanticCommand) rendererMocks.semanticCommandHandlers.set(termId, (event) => onSemanticCommand(termId, event));
    if (onBroadcastInput) rendererMocks.broadcastInputHandlers.set(termId, (data, binary) => onBroadcastInput(termId, data, binary));
    if (inputLabel) rendererMocks.inputLabels.set(termId, inputLabel);
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
        if (tabType === 'local') {
          const create = window.janet.terminalCreate({
            id: termId,
            cwd: initialCwd,
            ...(startupCommands?.length ? { startupCommands } : {}),
            ...(startupShellDialect ? { startupShellDialect } : {}),
          });
          const publishReady = () => {
            readyTermIds.push(termId);
            onReady?.(termId);
          };
          if (rendererMocks.awaitLocalCreate) {
            create.then(() => {
              if (effectActive) publishReady();
            });
          } else {
            publishReady();
          }
        } else {
          onReady?.(termId);
          return;
        }
      } else {
        onReady?.(termId);
      }
      return () => { effectActive = false; };
    }, [termId, hasSession, initialCwd, tabType, startupCommands, startupShellDialect, onReady]);

    return (
      <div
        ref={containerRef}
        data-testid={`terminal-${termId}`}
        data-terminal-focus-target
        data-terminal-id={termId}
        onFocus={() => onFocus?.(termId)}
      >
        {termId}
      </div>
    );
  }

  return { default: MockTerminalPane, disposeCachedTerminal: rendererMocks.disposeCachedTerminal };
});

// Most scenarios exercise existing Library sessions, not first-install onboarding.
function savedSettings(overrides: any = {}) {
  const session = overrides.session ?? {
    tabs: [{ id: 'saved-work', title: 'Terminal', type: 'local', cwd: '/home/test', root: { type: 'split', direction: 'vertical', sizes: [1], children: [{ type: 'leaf', cwd: '/home/test' }] } }],
    activeTabId: 'saved-work',
  };
  return { keybindings: {}, workspaceTabs: [], ...overrides, session: {
    groups: [{ id: 'library', name: 'Test library', kind: 'folder', directory: '/home/test' }], ...session,
  } };
}

beforeEach(() => {
  mountedTermIds.length = 0;
  readyTermIds.length = 0;
  rendererMocks.disposeCachedTerminal.mockReset();
  rendererMocks.awaitLocalCreate = false;
  rendererMocks.paletteActions = [];
  rendererMocks.titlebarProps = null;
  rendererMocks.shortcutEditorProps = null;
  rendererMocks.sidebarProps = null;
  rendererMocks.verticalTabBarProps = null;
  rendererMocks.prepareForCloseHandler = null;
  rendererMocks.terminalExitHandler = null;
  rendererMocks.cwdChangeHandlers.clear();
  rendererMocks.agentEventHandlers.clear();
  rendererMocks.semanticCommandStartedHandlers.clear();
  rendererMocks.semanticCommandCancelledHandlers.clear();
  rendererMocks.semanticCommandHandlers.clear();
  rendererMocks.broadcastInputHandlers.clear();
  rendererMocks.inputLabels.clear();
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
    selectLocalDirectory: vi.fn().mockResolvedValue(null),
    getSettings: vi.fn().mockResolvedValue(savedSettings({ notificationsEnabled: false, notificationThresholdSeconds: 10 })),
    getSettingsRecoveryState: vi.fn().mockResolvedValue({ previousAvailable: false }),
    restorePreviousSettings: vi.fn().mockResolvedValue({ keybindings: {}, workspaceTabs: [] }),
    resetSettings: vi.fn().mockResolvedValue({ keybindings: {}, workspaceTabs: [] }),
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
  it.each([true, false])('adds a batch without replacing existing terminals (grouped=%s)', async grouped => {
    window.janet.workspaceDirectory = vi.fn().mockResolvedValue('/home/test/project');
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({ session: {
      groups: [{ id: 'work', name: 'Work', directory: '/home/test' }],
      tabs: [{ id: 'project', groupId: 'work', title: 'Project', type: 'local', cwd: '/home/test/project', root: { type: 'leaf', cwd: '/home/test/project' } }],
      activeTabId: 'project',
    } }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add terminals' }));
    const dialog = screen.getByRole('dialog', { name: 'Add terminals' });
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Codex' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add terminals' }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(4));
    await waitFor(() => expect(within(screen.getAllByTestId(/terminal-/)[1]).getByRole('textbox')).toHaveFocus());
    await waitFor(() => {
      const creations = vi.mocked(window.janet.terminalCreate).mock.calls.map(([request]) => request);
      expect(creations.filter(request => request.startupCommands?.[0] === 'codex')).toHaveLength(3);
    });
    const creations = vi.mocked(window.janet.terminalCreate).mock.calls.map(([request]) => request);
    expect(creations.every(request => request.cwd === '/home/test/project')).toBe(true);
    expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
  });
  it('passes the local pane names to their terminal inputs', async () => {
    const noop = vi.fn();
    const baseProps = {
      tabId: 'named-inputs',
      tabType: 'local' as const,
      onTerminalReady: noop,
      onTerminalRemoved: noop,
      onAddTerminals: noop,
      onClosePane: noop,
      onResizePane: noop,
      onMovePane: noop,
      onPaneDragStart: noop,
      onPaneDragOver: noop,
      onPaneDragEnd: noop,
      onToggleMaximizePane: noop,
    };
    const { rerender } = render(
      <SplitPane
        {...baseProps}
        node={{ type: 'leaf', id: 'local-input', terminalType: 'local', title: 'Tests' }}
      />,
    );

    expect(rendererMocks.inputLabels.get('local-input')).toBe('Tests — Local terminal pane');

    rerender(
      <SplitPane
        {...baseProps}
        node={{ type: 'leaf', id: 'second-input', terminalType: 'local', title: 'Deploy' }}
      />,
    );
    expect(rendererMocks.inputLabels.get('second-input')).toBe('Deploy — Local terminal pane');
  });

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
      onAddTerminals: vi.fn(), onClosePane: vi.fn(), onResizePane: vi.fn(), onMovePane: vi.fn(),
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
    await splitFromPalette();
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
    await splitFromPalette();
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
    await splitFromPalette();
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
    await splitFromPalette();
    screen.getAllByRole('checkbox', { name: /include .* in broadcast input/i }).forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Start broadcast input' }));
    expect(screen.getByRole('status', { name: /broadcast input active/i })).toBeInTheDocument();

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
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
      await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
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

  it('persists a submitted command immediately and updates it when execution finishes', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    const termId = terminal.dataset.terminalId!;

    act(() => rendererMocks.semanticCommandStartedHandlers.get(termId)!({
      command: 'tmux attach', startedAt: 10,
    }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    const started = historyUpdates()[0].commandHistory[0];
    expect(started).toMatchObject({ command: 'tmux attach', startedAt: 10, durationMs: 0 });
    expect(started).not.toHaveProperty('exitCode');
    expect(started).not.toHaveProperty('output');
    expect(started).not.toHaveProperty('running');

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
    const dialog = await screen.findByRole('dialog', { name: 'Command history' });
    expect(within(dialog).getByRole('option', { name: /tmux attach.*running/i })).toBeInTheDocument();

    act(() => rendererMocks.semanticCommandHandlers.get(termId)!({
      ...semanticEvent('tmux attach'), startedAt: 10, durationMs: 25,
    }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));
    const completed = historyUpdates()[1].commandHistory[0];
    expect(completed).toMatchObject({
      id: started.id, command: 'tmux attach', startedAt: 10, durationMs: 25, exitCode: 0,
    });
    expect(completed).not.toHaveProperty('running');
    expect(within(dialog).getByRole('option', { name: 'tmux attach' })).toBeInTheDocument();
  });

  it('keeps an accepted command but clears Running when the lifecycle is cancelled', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    const termId = terminal.dataset.terminalId!;
    const event = { command: 'exit', startedAt: 10 };

    act(() => rendererMocks.semanticCommandStartedHandlers.get(termId)!(event));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
    const dialog = await screen.findByRole('dialog', { name: 'Command history' });
    expect(within(dialog).getByRole('option', { name: /exit.*running/i })).toBeInTheDocument();

    act(() => rendererMocks.semanticCommandCancelledHandlers.get(termId)!(event));

    expect(historyUpdates()).toHaveLength(1);
    expect(within(dialog).getByRole('option', { name: 'exit' })).toBeInTheDocument();
  });

  it('clears Running when the owning local terminal exits without D', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    const termId = terminal.dataset.terminalId!;

    act(() => rendererMocks.semanticCommandStartedHandlers.get(termId)!({ command: 'exit', startedAt: 10 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
    const dialog = await screen.findByRole('dialog', { name: 'Command history' });
    expect(within(dialog).getByRole('option', { name: /exit.*running/i })).toBeInTheDocument();

    act(() => rendererMocks.terminalExitHandler!({ id: termId, exitCode: 0, signal: 0 }));

    expect(within(dialog).getByRole('option', { name: 'exit' })).toBeInTheDocument();
  });

  it('keeps the same history ID when completion and terminal exit race a pending start write', async () => {
    const startSave = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => (
      update.commandHistory && historyUpdates().length === 1 ? startSave.promise : Promise.resolve()
    ));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    const termId = terminal.dataset.terminalId!;

    act(() => rendererMocks.semanticCommandStartedHandlers.get(termId)!({ command: 'exit', startedAt: 10 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    const started = historyUpdates()[0].commandHistory[0];
    act(() => rendererMocks.semanticCommandHandlers.get(termId)!({
      ...semanticEvent('exit'), startedAt: 10,
    }));
    act(() => rendererMocks.terminalExitHandler!({ id: termId, exitCode: 0, signal: 0 }));

    await act(async () => startSave.resolve());
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));
    expect(historyUpdates()[1].commandHistory[0]).toMatchObject({
      id: started.id, command: 'exit', durationMs: 10,
    });
  });

  it('persists overlapping successful completions in callback order without loss', async () => {
    const first = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => (
      update.commandHistory && historyUpdates().length === 1 ? first.promise : Promise.resolve()
    ));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
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
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;

    act(() => emit({ ...semanticEvent('repeat'), startedAt: 10 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    act(() => emit({ ...semanticEvent('repeat'), startedAt: 30 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));

    expect(historyUpdates()[1].commandHistory).toHaveLength(1);
    expect(historyUpdates()[1].commandHistory[0]).toMatchObject({ command: 'repeat', startedAt: 30 });
  });

  it('does not let an older overlapping run replace a newer duplicate', async () => {
    render(<App />);
    await splitFromPalette();
    const [firstId, secondId] = (await screen.findAllByTestId(/terminal-/))
      .map((terminal) => terminal.dataset.terminalId!);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));

    act(() => rendererMocks.semanticCommandStartedHandlers.get(firstId)!({ command: 'repeat', startedAt: 10 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));
    act(() => rendererMocks.semanticCommandStartedHandlers.get(secondId)!({ command: 'repeat', startedAt: 20 }));
    await waitFor(() => expect(historyUpdates()).toHaveLength(2));
    expect(historyUpdates()[1].commandHistory[0]).toMatchObject({ command: 'repeat', startedAt: 20 });

    act(() => rendererMocks.semanticCommandHandlers.get(firstId)!({
      ...semanticEvent('repeat'), startedAt: 10,
    }));
    await act(async () => Promise.resolve());

    expect(historyUpdates()).toHaveLength(2);
  });

  it('removes a command-history entry from settings and the picker', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
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

  it('keeps a running entry when its removal fails and still completes it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<App />);
      const terminal = await screen.findByTestId(/terminal-/);
      await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
      const termId = terminal.dataset.terminalId!;
      act(() => rendererMocks.semanticCommandStartedHandlers.get(termId)!({ command: 'still running', startedAt: 10 }));
      await waitFor(() => expect(historyUpdates()).toHaveLength(1));
      const started = historyUpdates()[0].commandHistory[0];

      act(() => rendererMocks.paletteActions.find((action) => action.id === 'history-toggle')!.handler());
      const dialog = await screen.findByRole('dialog', { name: 'Command history' });
      vi.mocked(window.janet.setSettings).mockRejectedValueOnce(new Error('disk full'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove still running from command history' }));
      await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
        'Failed to remove command history entry:', expect.any(Error),
      ));
      expect(within(dialog).getByRole('option', { name: /still running.*running/i })).toBeInTheDocument();

      act(() => rendererMocks.semanticCommandHandlers.get(termId)!({
        ...semanticEvent('still running'), startedAt: 10,
      }));
      await waitFor(() => expect(historyUpdates()).toHaveLength(3));
      expect(historyUpdates()[2].commandHistory[0]).toMatchObject({ id: started.id, durationMs: 10 });
      expect(within(dialog).getByRole('option', { name: 'still running' })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('resolves ownership and local context only when a queued completion persists', async () => {
    const blocker = deferred();
    vi.mocked(window.janet.setSettings).mockImplementation((update: any) => (
      update.commandHistory && historyUpdates().length === 1 ? blocker.promise : Promise.resolve()
    ));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
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
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    const emit = rendererMocks.semanticCommandHandlers.get(terminal.dataset.terminalId!)!;
    act(() => { emit(semanticEvent('first')); emit(semanticEvent('stale')); });
    await waitFor(() => expect(historyUpdates()).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: /close (?:pane|terminal)/i }));
    await confirmPendingAction(/^close tab$/i);
    await act(async () => blocker.resolve());
    await waitFor(() => expect(screen.queryAllByTestId(/terminal-/)).toHaveLength(0));
    await act(async () => Promise.resolve());
    expect(historyUpdates()).toHaveLength(1);
  });

  it('re-resolves the active focused terminal when history selection pastes without Enter', async () => {
    const pasted = vi.fn();
    window.addEventListener('janet:terminal-paste-request', pasted);
    try {
      render(<App />);
      await splitFromPalette();
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
      target: { tabId: rendererMocks.verticalTabBarProps.activeTabId, termId },
    });
    expect(JSON.stringify(vi.mocked(window.janet.notifyCommandCompleted).mock.calls)).not.toMatch(/secret command|secret output|command|output/);
  });

  it('does not notify after exact tab ownership becomes stale', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const termId = terminal.dataset.terminalId!;
    const staleHandler = rendererMocks.semanticCommandHandlers.get(termId)!;
    const oldTabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
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
    const channel = screen.getByRole('status', { name: 'Terminal status announcements' });
    await waitFor(() => expect(rendererMocks.terminalExitHandler).toBeTypeOf('function'));

    act(() => rendererMocks.agentEventHandlers.get(termId)!({
      version: 1, provider: 'hermes', event: 'turn.start',
      sessionId: 'session-1', turnId: 'turn-1',
    }));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toMatchObject({ kind: 'running', label: 'Hermes · Running · 1 busy', busyCount: 1 }));

    act(() => rendererMocks.terminalExitHandler!({ id: termId, exitCode: 17, signal: 0 }));

    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toMatchObject({ kind: 'exited', label: 'Exited' }));
    expect(screen.getByText('Exited')).toHaveClass('leaf-awareness', 'exited');
    expect(channel).toHaveTextContent('Terminal · Terminal — Local terminal pane · Exited');
  });

  it('announces an actionable terminal status once through one polite channel', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs: [{
          id: 'project-tab', title: 'Project', type: 'local',
          root: { type: 'leaf', title: 'Tests' },
        }],
        activeTabId: 'project-tab',
      },
    }));
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const emit = rendererMocks.agentEventHandlers.get(terminal.dataset.terminalId!)!;
    const tabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    const channel = screen.getByRole('status', { name: 'Terminal status announcements' });

    expect(channel).toHaveAttribute('aria-live', 'polite');
    expect(channel).toHaveAttribute('aria-atomic', 'true');
    expect(channel).toHaveClass('sr-only');
    expect(channel).toBeEmptyDOMElement();
    expect(screen.getAllByRole('status', { name: 'Terminal status announcements' })).toHaveLength(1);

    act(() => emit({
      version: 1, provider: 'hermes', event: 'session.start', sessionId: 'session-1',
    }));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toMatchObject({ kind: 'ready', label: 'Hermes · Ready' }));
    expect(channel).toBeEmptyDOMElement();

    act(() => emit({
      version: 1, provider: 'hermes', event: 'turn.start',
      sessionId: 'session-1', turnId: 'turn-1',
    }));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toMatchObject({ kind: 'running', label: 'Hermes · Running · 1 busy', busyCount: 1 }));
    expect(channel).toBeEmptyDOMElement();

    act(() => emit({
      version: 1, provider: 'hermes', event: 'attention.request',
      sessionId: 'session-1', turnId: 'turn-1',
    }));
    await waitFor(() => expect(channel).toHaveTextContent(
      'Project · Tests — Local terminal pane · Hermes · Needs input',
    ));

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(channel, { childList: true, characterData: true, subtree: true });
    act(() => emit({
      version: 1, provider: 'hermes', event: 'attention.request',
      sessionId: 'session-1', turnId: 'turn-1',
    }));
    await act(() => Promise.resolve());
    expect(mutations).toHaveLength(0);

    act(() => emit({
      version: 1, provider: 'hermes', event: 'attention.resolve',
      sessionId: 'session-1', turnId: 'turn-1',
    }));
    await waitFor(() => expect(channel).toBeEmptyDOMElement());
    mutations.length = 0;
    act(() => emit({
      version: 1, provider: 'hermes', event: 'attention.request',
      sessionId: 'session-1', turnId: 'turn-1',
    }));
    await waitFor(() => expect(mutations.length).toBeGreaterThan(0));
    expect(channel).toHaveTextContent('Hermes · Needs input');
    observer.disconnect();
  });

  it('disambiguates duplicate pane labels without exposing terminal IDs', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs: [{
          id: 'project-tab', title: 'Project', type: 'local',
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [
              { type: 'leaf', title: 'terminal' },
              { type: 'leaf', title: 'terminal' },
            ],
          },
        }],
        activeTabId: 'project-tab',
      },
    }));
    render(<App />);
    const terminals = await screen.findAllByTestId(/terminal-/);
    const secondTerminalId = terminals[1].dataset.terminalId!;
    const channel = screen.getByRole('status', { name: 'Terminal status announcements' });
    const emit = rendererMocks.agentEventHandlers.get(secondTerminalId)!;
    act(() => emit({
      version: 1, provider: 'hermes', event: 'session.start', sessionId: 'session-1',
    }));
    const tabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[tabId])
      .toMatchObject({ kind: 'ready', label: 'Hermes · Ready' }));

    act(() => emit({
      version: 1, provider: 'hermes', event: 'attention.request',
      sessionId: 'session-1', turnId: 'turn-1',
    }));

    await waitFor(() => expect(channel).toHaveTextContent(
      'Project · Terminal — Local terminal pane 2 · Hermes · Needs input',
    ));
    expect(channel).not.toHaveTextContent(secondTerminalId);
  });

  it('marks a background turn outcome unseen and acknowledges it when its tab is selected', async () => {
    render(<App />);
    const firstTerminal = await screen.findByTestId(/terminal-/);
    const firstTerminalId = firstTerminal.dataset.terminalId!;
    const firstTabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    const channel = screen.getByRole('status', { name: 'Terminal status announcements' });

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
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
      .toMatchObject({ kind: 'finished', label: 'Hermes · Turn finished · 1 unread', unseenCount: 1 }));
    expect(channel).toHaveTextContent('Hermes · Turn finished');

    act(() => {
      emit({
        version: 1, provider: 'hermes', event: 'turn.start',
        sessionId: 'session-1', turnId: 'turn-2',
      });
      emit({
        version: 1, provider: 'hermes', event: 'turn.end',
        sessionId: 'session-1', turnId: 'turn-2', outcome: 'failed',
      });
    });
    await waitFor(() => expect(channel).toHaveTextContent('Hermes · Turn failed'));

    const failedMutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => failedMutations.push(...records));
    observer.observe(channel, { childList: true, characterData: true, subtree: true });
    act(() => {
      emit({
        version: 1, provider: 'hermes', event: 'turn.start',
        sessionId: 'session-1', turnId: 'turn-3',
      });
      emit({
        version: 1, provider: 'hermes', event: 'turn.end',
        sessionId: 'session-1', turnId: 'turn-3', outcome: 'failed',
      });
    });
    await waitFor(() => expect(failedMutations.length).toBeGreaterThan(0));
    expect(channel).toHaveTextContent('Hermes · Turn failed');
    observer.disconnect();

    act(() => {
      emit({
        version: 1, provider: 'hermes', event: 'turn.start',
        sessionId: 'session-1', turnId: 'turn-4',
      });
      emit({
        version: 1, provider: 'hermes', event: 'turn.end',
        sessionId: 'session-1', turnId: 'turn-4', outcome: 'interrupted',
      });
    });
    await waitFor(() => expect(channel).toHaveTextContent('Hermes · Interrupted'));

    act(() => rendererMocks.verticalTabBarProps.onSelectTab(firstTabId));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.awarenessByTab[firstTabId])
      .toMatchObject({ kind: 'ready', label: 'Hermes · Ready' }));
    expect(screen.getByText('Hermes · Ready')).toHaveClass('leaf-awareness', 'ready');
    expect(channel).toBeEmptyDOMElement();
  });

  it('ignores an actionable status from a removed terminal owner', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const staleEmit = rendererMocks.agentEventHandlers.get(terminal.dataset.terminalId!)!;
    const oldTabId = rendererMocks.verticalTabBarProps.tabs[0].id;
    const channel = screen.getByRole('status', { name: 'Terminal status announcements' });

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2));
    act(() => rendererMocks.verticalTabBarProps.onCloseTab(oldTabId));
    await confirmPendingAction(/close tab/i);

    act(() => staleEmit({
      version: 1, provider: 'hermes', event: 'attention.request',
      sessionId: 'removed-session', turnId: 'removed-turn',
    }));
    await act(() => Promise.resolve());
    expect(channel).toBeEmptyDOMElement();
  });

  it('opens snippets with the configured shortcut and routes pasted content to the focused terminal', async () => {
    const pasted = vi.fn();
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: { 'palette-toggle': 'Ctrl+K', 'snippets-toggle': 'Ctrl+Shift+P' }, workspaceTabs: [],
      notificationsEnabled: false, notificationThresholdSeconds: 10,
    }));
    window.addEventListener('janet:terminal-paste-request', pasted);
    try {
      render(<App />);
      await screen.findByRole('button', { name: 'Add terminals' });
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

    const splitButton = await screen.findByRole('button', { name: 'Add terminals' });
    await waitFor(() => {
      expect(mountedTermIds).toHaveLength(1);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1);
    });
    expect(window.janet.getSettings).toHaveBeenCalledTimes(1);

    await splitFromPalette();

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(mountedTermIds).toHaveLength(2);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
      expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    });

    fireEvent.focus(screen.getAllByTestId(/terminal-/)[1]);
    await splitFromPalette();

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(3);
      expect(mountedTermIds).toHaveLength(3);
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(3);
      expect(window.janet.terminalDestroy).not.toHaveBeenCalled();
    });

    expect(new Set(mountedTermIds).size).toBe(3);
  });

  it('releases a pane closed before local creation completes and reuses its capacity', async () => {
    rendererMocks.awaitLocalCreate = true;
    rendererMocks.disposeCachedTerminal
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    render(<App />);

    await waitFor(() => expect(readyTermIds).toHaveLength(1));
    const pendingCreate = deferred<void>();
    vi.mocked(window.janet.terminalCreate).mockReturnValueOnce(pendingCreate.promise);
    await splitFromPalette();

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const pendingId = screen.getAllByTestId(/terminal-/)[1].dataset.terminalId!;
    expect(readyTermIds).not.toContain(pendingId);

    fireEvent.click(screen.getAllByRole('button', { name: /close (?:pane|terminal)/i })[1]);
    await confirmPendingAction(/^close pane$/i);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(window.janet.terminalDestroy).toHaveBeenCalledTimes(1);
    expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: pendingId });

    await act(async () => pendingCreate.resolve());
    expect(readyTermIds).not.toContain(pendingId);
    expect(window.janet.terminalDestroy).toHaveBeenCalledTimes(1);

    await splitFromPalette();
    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
      expect(readyTermIds).toHaveLength(2);
    });
    expect(window.janet.terminalCreate).toHaveBeenCalledTimes(3);
    expect(window.janet.terminalDestroy).toHaveBeenCalledTimes(1);
  });

  it('moves an existing pane without creating or destroying a terminal', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Add terminals' });
    await splitFromPalette();
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

  it.each([
    ['right', 'split-right'],
    ['below', 'split-down'],
  ] as const)('focuses a newly split pane %s after its terminal attaches', async (_side, splitButton) => {
    render(<App />);

    const originalTerminal = await screen.findByTestId(/terminal-/);
    await splitFromPalette(splitButton);

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const newTerminalInput = within(screen.getAllByTestId(/terminal-/)[1]).getByRole('textbox');

    await waitFor(() => expect(newTerminalInput).toHaveFocus());
    expect(within(originalTerminal).getByRole('textbox')).not.toHaveFocus();
  });

  it('keeps the newly split pane current after focus moves to a workspace tool', async () => {
    render(<App />);

    await splitFromPalette();
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const [originalTerminal, newTerminal] = screen.getAllByTestId(/terminal-/);
    const originalPane = originalTerminal.closest('.terminal-leaf');
    const newPane = newTerminal.closest('.terminal-leaf');

    expect(originalPane).not.toHaveAttribute('aria-current');
    expect(newPane).toHaveAttribute('aria-current', 'true');

    const workspaceTool = screen.getByRole('button', { name: 'Mock tool content' });
    act(() => workspaceTool.focus());

    expect(workspaceTool).toHaveFocus();
    expect(newPane).toHaveAttribute('aria-current', 'true');

    act(() => within(originalTerminal).getByRole('textbox').focus());

    expect(originalPane).toHaveAttribute('aria-current', 'true');
    expect(newPane).not.toHaveAttribute('aria-current');
  });

  it('focuses a pane after its heading is clicked without taking keyboard focus from the heading', async () => {
    render(<App />);
    await splitFromPalette();
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    const pane = screen.getAllByTestId(/terminal-/)[1].closest('.terminal-leaf')!;
    const heading = pane.querySelector<HTMLElement>('.terminal-leaf-header')!;
    const input = within(pane as HTMLElement).getByRole('textbox');
    act(() => heading.focus());
    expect(heading).toHaveFocus();

    fireEvent.click(heading);
    expect(input).toHaveFocus();
  });

  it('surviving pane fills space when sibling is closed', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Add terminals' });
    await splitFromPalette();

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    // Close the second pane
    const closeButtons = screen.getAllByRole('button', { name: /close (?:pane|terminal)/i });
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

    await screen.findByRole('button', { name: 'Add terminals' });
    await splitFromPalette();
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

  it.each(['right-click', 'keyboard'] as const)('renames the clicked pane through its %s heading menu', async (method) => {
    render(<App />);
    await splitFromPalette();
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const [firstTerminal, secondTerminal] = screen.getAllByTestId(/terminal-/);
    const firstPane = firstTerminal.closest('.terminal-leaf')!;
    const secondPane = secondTerminal.closest('.terminal-leaf')!;
    const heading = secondPane.querySelector<HTMLElement>('.terminal-leaf-header')!;
    act(() => within(firstTerminal).getByRole('textbox').focus());

    const openMenu = () => method === 'right-click'
      ? fireEvent.contextMenu(heading, { clientX: 200, clientY: 100 })
      : fireEvent.keyDown(heading, { key: 'F10', shiftKey: true });
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(heading).toHaveFocus();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename terminal' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Terminal name' }), { target: { value: 'Logs' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(secondPane.querySelector('.leaf-title-text')).toHaveTextContent('Logs'));
    expect(firstPane.querySelector('.leaf-title-text')).toHaveTextContent('Terminal');
    await waitFor(() => expect(within(secondTerminal).getByRole('textbox')).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renames the focused pane with F2 and returns focus to its terminal', async () => {
    render(<App />);

    await splitFromPalette();
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
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
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
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [], fontSize: 18,
      notificationsEnabled: false, notificationThresholdSeconds: 10,
    }));
    render(<App />);
    await waitFor(() => expect(window.janet.setSettings).toHaveBeenCalledWith({
      keybindings: expect.objectContaining({
        'settings-toggle': 'Ctrl+,',
        'font-reset': 'Ctrl+0',
      }),
    }));
    vi.mocked(window.janet.setSettings).mockClear();

    fireEvent.keyDown(document, { key: ',', ctrlKey: true });
    await waitFor(() => expect(rendererMocks.titlebarProps.settingsOpen).toBe(true));
    act(() => rendererMocks.titlebarProps.onSettingsClose());

    fireEvent.keyDown(document, { key: '0', ctrlKey: true });
    await waitFor(() => expect(window.janet.setSettings).toHaveBeenCalledWith({ fontSize: 14 }));
  });

  it('opens keyboard shortcut editing in a modal from Settings', async () => {
    render(<App />);
    await waitFor(() => expect(window.janet.setSettings).toHaveBeenCalledWith({
      keybindings: expect.objectContaining({ 'settings-toggle': 'Ctrl+,' }),
    }));

    fireEvent.keyDown(document, { key: ',', ctrlKey: true });
    const openShortcuts = await screen.findByRole('button', { name: 'Keyboard shortcuts' });
    fireEvent.click(openShortcuts);

    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(rendererMocks.titlebarProps.settingsOpen).toBe(false);
    expect(screen.queryByRole('button', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument());
  });

  it('shows failed automatic workspace persistence and retries the current state', async () => {
    let failSessionSave = true;
    vi.mocked(window.janet.setSettings).mockImplementation(async (update) => {
      if (update.session && failSessionSave) throw new Error('Disk unavailable');
    });
    render(<App />);
    const retry = await screen.findByRole('button', { name: 'Retry workspace save' }, { timeout: 2_000 });
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace changes could not be saved');
    failSessionSave = false;
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry workspace save' })).not.toBeInTheDocument());
    expect(window.janet.setSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ groups: [{ id: 'library', name: 'Test library', kind: 'folder', directory: '/home/test' }] }),
    }));
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
      expect.objectContaining({ id: 'move-pane-left', shortcut: '' }),
      expect.objectContaining({ id: 'move-pane-right', shortcut: '' }),
      expect.objectContaining({ id: 'move-pane-up', shortcut: '' }),
      expect.objectContaining({ id: 'move-pane-down', shortcut: '' }),
      expect.objectContaining({ id: 'save-document', shortcut: '' }),
      expect.objectContaining({ id: 'close-document', shortcut: '' }),
    ])));
  });

  it('discovers core workflows and opens workspace creation from the palette', async () => {
    render(<App />);
    await screen.findByTestId(/terminal-/);

    await waitFor(() => expect(rendererMocks.paletteActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sidebar-files', keywords: ['files', 'project'] }),
      expect.objectContaining({ id: 'settings-toggle', keywords: ['preferences'] }),
      expect.objectContaining({
        id: 'new-workspace',
        label: 'New workspace',
        keywords: ['group', 'layout'],
      }),
    ])));

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-workspace')!.handler());
    expect(rendererMocks.verticalTabBarProps.entryRequest).toEqual({ action: 'create' });
    expect(rendererMocks.paletteActions.some((action) => action.id === 'save-workspace')).toBe(false);
  });

  it('starts a fresh profile empty and offers workspace creation', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({ mainDirectory: '/work', keybindings: {}, workspaceTabs: [] });
    render(<App />);
    const entry = await screen.findByRole('region', { name: 'Create your first workspace' });
    expect(screen.queryAllByTestId(/terminal-/)).toHaveLength(0);
    expect(window.janet.terminalCreate).not.toHaveBeenCalled();
    fireEvent.click(within(entry).getByRole('button', { name: 'Create workspace' }));
    expect(rendererMocks.verticalTabBarProps.entryRequest).toEqual({ action: 'create', groupId: undefined });
  });

  it('opens standalone terminals in Library after workspace setup was skipped', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({ mainDirectory: null, mainDirectorySetupSkipped: true, keybindings: {}, workspaceTabs: [] });
    render(<App />);
    await screen.findByRole('region', { name: 'Choose where to work' });
    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource?.cwd).toBe('/home/test'));
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    expect(rendererMocks.verticalTabBarProps.groups).toEqual([expect.objectContaining({ kind: 'folder', name: 'Home' })]);
  });

  it('routes linking a Library folder independently of workspace creation', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue({ keybindings: {}, workspaceTabs: [] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link folder to Library' }));
    expect(rendererMocks.verticalTabBarProps.entryRequest).toEqual({ action: 'link' });
    expect(window.janet.terminalCreate).not.toHaveBeenCalled();
  });

  it('routes an empty Library entry to project creation in that entry', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({ session: { tabs: [], activeTabId: null } }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create project' }));
    expect(rendererMocks.verticalTabBarProps.entryRequest).toEqual({ action: 'create', groupId: 'library' });
    expect(window.janet.terminalCreate).not.toHaveBeenCalled();
  });

  it('does not show first exposure when the original session restores a valid workspace', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs: [{
          id: 'restored', title: 'Restored workspace', type: 'local',
          root: { type: 'leaf', title: 'Restored pane', terminalType: 'local' },
        }],
        activeTabId: 'restored',
      },
    }));

    render(<App />);
    expect(await screen.findByText('Restored pane')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
  });

  it('moves the active pane by keyboard and pointer without replacing its terminal', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: { 'move-pane-right': 'Alt+ArrowRight' }, workspaceTabs: [],
      session: {
        tabs: [{
          id: 'move-tab', title: 'Move panes', type: 'local', selectedPanePath: [0],
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 2],
            children: [{ type: 'leaf', title: 'left' }, { type: 'leaf', title: 'right' }],
          },
        }],
        activeTabId: 'move-tab',
      },
    }));

    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const leftPane = screen.getByText('left').closest('.terminal-leaf')!;
    const rightPane = screen.getByText('right').closest('.terminal-leaf')!;
    const leftTerminal = within(leftPane as HTMLElement).getByTestId(/terminal-/);
    const initialIds = screen.getAllByTestId(/terminal-/).map((terminal) => terminal.textContent);
    const leftFlex = (leftPane.parentElement as HTMLElement).style.flex;
    const rightFlex = (rightPane.parentElement as HTMLElement).style.flex;
    fireEvent.focus(leftTerminal);
    fireEvent.click(within(leftPane as HTMLElement).getByRole('button', { name: /maximize pane/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));

    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });

    await waitFor(() => expect(screen.getAllByText(/^(left|right)$/).map((title) => title.textContent))
      .toEqual(['right', 'left']));
    expect(screen.getAllByTestId(/terminal-/).map((terminal) => terminal.textContent))
      .toEqual([initialIds[1], initialIds[0]]);
    let movedPane = screen.getByText('left').closest('.terminal-leaf')!;
    expect((movedPane.parentElement as HTMLElement).style.flex).toBe(leftFlex);
    expect((screen.getByText('right').closest('.terminal-leaf')!.parentElement as HTMLElement).style.flex)
      .toBe(rightFlex);
    expect(movedPane).toHaveAttribute('aria-current', 'true');
    expect(within(movedPane as HTMLElement).getByRole('textbox')).toHaveFocus();

    fireEvent.click(screen.getByTestId('command-palette-action-move-pane-left'));

    await waitFor(() => expect(screen.getAllByText(/^(left|right)$/).map((title) => title.textContent))
      .toEqual(['left', 'right']));
    expect(screen.getAllByTestId(/terminal-/).map((terminal) => terminal.textContent)).toEqual(initialIds);
    movedPane = screen.getByText('left').closest('.terminal-leaf')!;
    expect((movedPane.parentElement as HTMLElement).style.flex).toBe(leftFlex);
    expect((screen.getByText('right').closest('.terminal-leaf')!.parentElement as HTMLElement).style.flex)
      .toBe(rightFlex);
    expect(movedPane).toHaveAttribute('aria-current', 'true');
    expect(within(movedPane as HTMLElement).getByRole('textbox')).toHaveFocus();
    expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
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
    await waitFor(() => expect(screen.queryAllByTestId(/terminal-/)).toHaveLength(0));
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
      expect(screen.queryAllByTestId(/terminal-/)).toHaveLength(0);
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

    await screen.findByRole('button', { name: 'Add terminals' });
    await splitFromPalette();
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
      await screen.findByRole('button', { name: 'Add terminals' });
      await splitFromPalette();
      await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

      const focusedTerminal = screen.getAllByTestId(/terminal-/)[1];
      fireEvent.focus(focusedTerminal);
      await waitFor(() => {
        expect(rendererMocks.sidebarProps.explorerSource.key)
          .toBe(`local:${focusedTerminal.textContent}`);
      });

      fireEvent.click(screen.getByTestId('command-palette-action-search-toggle'));

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
      expect(screen.queryByRole('dialog', { name: 'SSH connections' })).toBeNull();
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
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'SSH connections' })).toBeNull();
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

  it('migrates a previously open Settings sidebar into the titlebar popover', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [],
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'settings',
      },
    }));

    render(<App />);

    await waitFor(() => {
      expect(rendererMocks.sidebarProps?.expanded).toBe(false);
      expect(rendererMocks.titlebarProps?.settingsOpen).toBe(true);
      expect(screen.queryByRole('dialog', { name: 'SSH connections' })).toBeNull();
    });
    expect(screen.getByRole('group', { name: 'Project tools position' })).toBeInTheDocument();
  });

  it('shows a recoverable startup state when settings cannot be loaded', async () => {
    window.janet.getSettings = vi.fn().mockRejectedValue(new Error('settings unavailable'));
    window.janet.resetSettings = vi.fn().mockResolvedValue({
      keybindings: {}, workspaceTabs: [], notificationsEnabled: false, notificationThresholdSeconds: 10,
    });

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
    expect(window.janet.resetSettings).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('titlebar')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId(/terminal-/)).toHaveLength(0));
  });

  it('restores a validated previous settings generation from startup recovery', async () => {
    window.janet.getSettings = vi.fn().mockRejectedValue(new Error('settings unavailable'));
    window.janet.getSettingsRecoveryState = vi.fn().mockResolvedValue({ previousAvailable: true });
    window.janet.restorePreviousSettings = vi.fn().mockResolvedValue({
      theme: 'dracula', keybindings: {}, workspaceTabs: [], notificationsEnabled: false,
      notificationThresholdSeconds: 10,
    });

    render(<App />);

    const restore = await screen.findByRole('button', { name: 'Restore previous' });
    fireEvent.click(restore);

    await waitFor(() => expect(window.janet.restorePreviousSettings).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('titlebar')).toBeInTheDocument();
  });

  it('maximizes a single pane within the terminal area and restores it to the split layout', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Add terminals' });
    await splitFromPalette();

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

  it('restores selected and maximized panes from structural paths without saving runtime ids', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {},
      workspaceTabs: [],
      session: {
        tabs: [{
          id: 'nested-tab',
          title: 'Nested panes',
          type: 'local',
          selectedPanePath: [1, 1],
          maximizedPanePath: [1, 1],
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [
              { type: 'leaf', title: 'left' },
              {
                type: 'split', direction: 'horizontal', sizes: [1, 1],
                children: [
                  { type: 'leaf', title: 'top right' },
                  { type: 'leaf', title: 'restored owner' },
                ],
              },
            ],
          },
        }],
        activeTabId: 'nested-tab',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    }));

    render(<App />);

    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.dataset.terminalId!;
    const currentPane = terminal.closest('.terminal-leaf')!;
    expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    expect(currentPane).toHaveAttribute('aria-current', 'true');
    expect(within(currentPane as HTMLElement).getByText('restored owner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore pane layout/i })).toBeInTheDocument();

    await waitFor(() => {
      const sessions = vi.mocked(window.janet.setSettings).mock.calls
        .map(([update]) => (update as any).session)
        .filter(Boolean);
      const savedTab = sessions.at(-1)?.tabs[0];
      expect(savedTab).toMatchObject({
        selectedPanePath: [1, 1],
        maximizedPanePath: [1, 1],
      });
      expect(JSON.stringify(savedTab)).not.toContain(terminalId);
    }, { timeout: 1_500 });

    fireEvent.click(screen.getByRole('button', { name: /restore pane layout/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(3));
    const restoredOwner = screen.getByText('restored owner').closest('.terminal-leaf')!;
    expect(document.querySelectorAll('.terminal-leaf[aria-current="true"]')).toHaveLength(1);
    expect(restoredOwner).toHaveAttribute('aria-current', 'true');
  });

  it('restores a selected pane without maximizing the layout', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs: [{
          id: 'selected-tab', title: 'Selected pane', type: 'local', selectedPanePath: [1],
          root: {
            type: 'split', direction: 'vertical', sizes: [1, 1],
            children: [{ type: 'leaf', title: 'left' }, { type: 'leaf', title: 'selected right' }],
          },
        }],
        activeTabId: 'selected-tab',
      },
    }));

    render(<App />);

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const selectedPane = screen.getByText('selected right').closest('.terminal-leaf')!;
    expect(document.querySelectorAll('.terminal-leaf[aria-current="true"]')).toHaveLength(1);
    expect(selectedPane).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('button', { name: /restore pane layout/i })).toBeNull();
  });

  it('restores a maximized layout before focusing an existing worktree terminal', async () => {
    render(<App />);
    await splitFromPalette();
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

  it('restores a maximized layout before splitting its current pane', async () => {
    render(<App />);
    await splitFromPalette();
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const existingTerminalIds = new Set(
      screen.getAllByTestId(/terminal-/).map((terminal) => terminal.getAttribute('data-terminal-id')),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /maximize pane/i })[1]);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    await waitFor(() => {
      expect(rendererMocks.paletteActions.find((action) => action.id === 'split-right')).toBeTruthy();
    });

    act(() => rendererMocks.paletteActions.find((action) => action.id === 'split-right')!.handler());

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(3));
    const newTerminal = screen.getAllByTestId(/terminal-/).find(
      (terminal) => !existingTerminalIds.has(terminal.getAttribute('data-terminal-id')),
    )!;
    const currentPanes = document.querySelectorAll('.terminal-leaf[aria-current="true"]');

    expect(currentPanes).toHaveLength(1);
    expect(currentPanes[0]).toBe(newTerminal.closest('.terminal-leaf'));
    expect(within(newTerminal).getByRole('textbox')).toHaveFocus();
  });

  it('clears maximized state if the maximized pane is closed', async () => {
    render(<App />);

    await screen.findByRole('button', { name: 'Add terminals' });
    await splitFromPalette();

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    fireEvent.click(screen.getAllByRole('button', { name: /maximize pane/i })[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: /restore pane layout/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /close (?:pane|terminal)/i }));
    await confirmPendingAction(/^close pane$/i);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /restore pane layout/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /maximize pane/i })).toBeNull();
  });

  it('resizes split panes from the keyboard', async () => {
    render(<App />);

    await splitFromPalette();
    const divider = await screen.findByRole('separator', { name: 'Resize left and right panes' });
    expect(divider).toHaveAttribute('aria-valuenow', '50');

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    await waitFor(() => expect(divider).toHaveAttribute('aria-valuenow', '55'));
    fireEvent.keyDown(divider, { key: 'Home' });
    await waitFor(() => expect(divider).toHaveAttribute('aria-valuenow', '10'));
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
        onAddTerminals={vi.fn()}
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
        onAddTerminals={vi.fn()}
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
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {},
      workspaceTabs: [{
        id: 'workspace-tab-1',
        name: 'JaneT repo',
        type: 'local',
        root: { type: 'leaf', terminalType: 'local', cwd: 'C:/Users/pckpr/projects/JaneT' },
        terminalCount: 1,
        splitDirection: 'vertical',
      }],
    }));

    render(<App />);

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    expect(window.janet.terminalCreate).not.toHaveBeenCalledWith(expect.objectContaining({
      cwd: 'C:/Users/pckpr/projects/JaneT',
    }));
  });

  it('passes each preset pane startup sequence to its matching local backend', async () => {
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
            terminalType: 'local' as const,
            startupCommands: ['hermes doctor', 'hermes -p forge --tui'],
            startupShellDialect: 'posix' as const,
          },
        ],
      },
      terminalCount: 2,
      splitDirection: 'vertical' as const,
    };
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {},
      workspaceTabs: [preset],
    }));

    render(<App />);

    await waitFor(() => {
      expect(rendererMocks.verticalTabBarProps?.onWorkspaceTabLaunch).toBeTypeOf('function');
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1);
    });
    (window.janet.terminalCreate as any).mockClear();

    await act(async () => {
      await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset, { id: 'default', name: 'My workspaces' });
    });

    await waitFor(() => {
      const terminals = screen.getAllByTestId(/terminal-/);
      expect(terminals).toHaveLength(2);
      expect(within(terminals[0]).getByRole('textbox')).toHaveFocus();
    });

    await waitFor(() => {
      expect(window.janet.terminalCreate).toHaveBeenCalledWith(expect.objectContaining({
        cwd: '/repo',
        startupCommands: ['npm install', 'npm run dev'],
      }));
      expect(window.janet.terminalCreate).toHaveBeenCalledWith(expect.objectContaining({
        startupCommands: ['hermes doctor', 'hermes -p forge --tui'],
        startupShellDialect: 'posix',
      }));
    });
    expect(window.janet.terminalWrite).not.toHaveBeenCalled();

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
      (tab: { title: string }) => tab.title === preset.name,
    );
    expect(launchedTab).toBeTruthy();
    expect(launchedTab.groupId).toBe('default');
    expect(rendererMocks.verticalTabBarProps.onSaveWorkspaceTab).toBeUndefined();
  });

  it('restores startup commands with a saved session and reruns them in fresh terminals', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
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
    }));

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

  it('focuses the last used pane after returning to a terminal tab', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
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
    }));

    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    const secondTerminal = screen.getAllByTestId(/terminal-/)[1];
    const secondTerminalInput = await within(secondTerminal).findByRole('textbox');
    act(() => secondTerminalInput.focus());
    await openSampleEditor();

    fireEvent.click(within(screen.getByTestId('vertical-tab-bar')).getByText('docs'));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId('vertical-tab-bar')).getByText('project'));

    await waitFor(() => {
      const terminals = screen.getAllByTestId(/terminal-/);
      expect(terminals).toHaveLength(2);
      expect(within(terminals[1]).getByRole('textbox')).toHaveFocus();
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
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
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
    }));
    render(<App />);
    await waitFor(() => expect(rendererMocks.sidebarProps.openLocalTerminals).toHaveLength(2));
    expect(within(screen.getByTestId('vertical-tab-bar')).getByText('main')).toBeInTheDocument();
    await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Focus last open terminal' }));

    await waitFor(() => {
      const cleanupTab = rendererMocks.verticalTabBarProps.tabs.find((tab: { title: string }) => tab.title === 'cleanup');
      expect(rendererMocks.verticalTabBarProps.activeTabId).toBe(cleanupTab.id);
      expect(within(screen.getByTestId(/terminal-/)).getByRole('textbox')).toHaveFocus();
    });
    await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2));
    expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2);
  });

  it('describes the terminal and cwd driving workspace tools', async () => {
    render(<App />);

    await waitFor(() => expect(rendererMocks.sidebarProps.explorerSource).toMatchObject({
      kind: 'local',
      cwd: '/home/test',
    }));
  });

  it('does not create an unsaveable terminal tab beyond the session budget', async () => {
    const tabs = new Array(64).fill(null).map((_, index) => ({
      id: `saved-${index}`, title: `Saved ${index}`, type: 'local', root: { type: 'leaf' },
    }));
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs, activeTabId: tabs[0].id, sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    }));

    render(<App />);
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(64));
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());

    expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(64);
  });

  it('does not split a pane beyond the shared terminal budget', async () => {
    const tabs = new Array(64).fill(null).map((_, index) => ({
      id: `saved-${index}`, title: `Saved ${index}`, type: 'local', root: { type: 'leaf' },
    }));
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
      keybindings: {}, workspaceTabs: [],
      session: {
        tabs, activeTabId: tabs[0].id, sidebarOpen: true, tabsOpen: true, sidebarSection: 'files',
      },
    }));

    render(<App />);
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));
    await splitFromPalette();

    expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
  });

  it('persists the open tabs to settings after a tab change', async () => {
    window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({ keybindings: {}, workspaceTabs: [] }));
    window.janet.setSettings = vi.fn().mockResolvedValue(undefined);

    render(<App />);

    // Wait for the initial terminal to mount.
    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });

    // Split right — adds a leaf to the active tab.
    await splitFromPalette();

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
        window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
          keybindings: { 'close-document': 'Ctrl+Alt+D' },
          workspaceTabs: [],
          notificationsEnabled: false,
          notificationThresholdSeconds: 10,
        }));
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
        window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
          keybindings: { 'close-document': 'Ctrl+Alt+D' },
          workspaceTabs: [],
          notificationsEnabled: false,
          notificationThresholdSeconds: 10,
        }));
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
        window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
          keybindings: { 'close-document': 'Ctrl+Alt+D' },
          workspaceTabs: [],
          notificationsEnabled: false,
          notificationThresholdSeconds: 10,
        }));
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
      window.janet.getSettings = vi.fn().mockResolvedValue(savedSettings({
        keybindings: { 'close-document': 'Ctrl+Alt+D' },
        workspaceTabs: [],
        notificationsEnabled: false,
        notificationThresholdSeconds: 10,
      }));
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

    await splitFromPalette();
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

  it('persists same-batch selected and maximized pane paths before close', async () => {
    render(<App />);
    await splitFromPalette();
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));
    await waitFor(() => expect(rendererMocks.prepareForCloseHandler).toBeTypeOf('function'));
    const maximizePane = rendererMocks.paletteActions.find((action) => action.id === 'maximize-pane')!;
    vi.mocked(window.janet.setSettings).mockClear();

    await act(async () => {
      maximizePane.handler();
      await rendererMocks.prepareForCloseHandler!({
        requestId: 'maximized-close',
        reason: 'application-quit',
      });
    });

    expect(window.janet.setSettings).toHaveBeenCalledWith({
      session: expect.objectContaining({
        tabs: [expect.objectContaining({
          selectedPanePath: [1],
          maximizedPanePath: [1],
        })],
      }),
    });
    expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
      requestId: 'maximized-close', resolution: 'saved',
    });
  });

  it('persists a same-batch active tab selection before close', async () => {
    render(<App />);
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.onSelectTab).toBeTypeOf('function'));
    act(() => rendererMocks.paletteActions.find((action) => action.id === 'new-terminal')!.handler());
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.tabs).toHaveLength(2));
    const [firstTab, secondTab] = rendererMocks.verticalTabBarProps.tabs;
    act(() => rendererMocks.verticalTabBarProps.onSelectTab(firstTab.id));
    await waitFor(() => expect(rendererMocks.verticalTabBarProps.activeTabId).toBe(firstTab.id));
    vi.mocked(window.janet.setSettings).mockClear();

    await act(async () => {
      rendererMocks.verticalTabBarProps.onSelectTab(secondTab.id);
      await rendererMocks.prepareForCloseHandler!({
        requestId: 'active-tab-close',
        reason: 'application-quit',
      });
    });

    expect(window.janet.setSettings).toHaveBeenCalledWith({
      session: expect.objectContaining({ activeTabId: secondTab.id }),
    });
  });

  it('persists a cwd reported in the same batch as close preparation', async () => {
    render(<App />);
    const terminal = await screen.findByTestId(/terminal-/);
    const terminalId = terminal.getAttribute('data-terminal-id')!;
    const latestCwd = 'C:/repo/latest';
    await waitFor(() => expect(rendererMocks.prepareForCloseHandler).toBeTypeOf('function'));

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
    const terminalInput = await within(terminal).findByRole('textbox');
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
