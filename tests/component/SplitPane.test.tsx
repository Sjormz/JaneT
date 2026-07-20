import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../../src/renderer/App';

const mountedTermIds: string[] = [];
const rendererMocks = vi.hoisted(() => ({
  disposeCachedTerminal: vi.fn(),
  paletteActions: [] as Array<{ id: string; handler: () => void }>,
  titlebarProps: null as any,
  sidebarProps: null as any,
  verticalTabBarProps: null as any,
  prepareForCloseHandler: null as null | ((request: {
    requestId: string;
    reason: 'window-close' | 'app-quit' | 'tray-stop' | 'update-install';
  }) => void | Promise<void>),
  sshConnectionClosedHandler: null as null | ((event: { id: string; reason: string }) => void),
  sshRetryHandlers: new Map<string, (
    termId: string,
    dimensions: { cols: number; rows: number },
  ) => void | Promise<void>>(),
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
  default: () => null,
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
    onFocus,
    onSshRetry,
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
    onFocus?: (id: string) => void;
    onSshRetry?: (
      id: string,
      dimensions: { cols: number; rows: number },
    ) => void | Promise<void>;
  }) {
    if (onSshRetry) rendererMocks.sshRetryHandlers.set(termId, onSshRetry);

    React.useEffect(() => {
      mountedTermIds.push(termId);
      return () => {
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
        data-testid={`terminal-${termId}`}
        data-terminal-focus-target
        data-ssh-connection-lost={sshConnectionLost ? 'true' : 'false'}
        tabIndex={0}
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
  rendererMocks.sidebarProps = null;
  rendererMocks.verticalTabBarProps = null;
  rendererMocks.prepareForCloseHandler = null;
  rendererMocks.sshConnectionClosedHandler = null;
  rendererMocks.sshRetryHandlers.clear();
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
    getSettings: vi.fn().mockResolvedValue({ keybindings: {}, workspaceTabs: [] }),
    setSettings: vi.fn().mockResolvedValue(undefined),
    terminalCreate: vi.fn().mockResolvedValue(undefined),
    terminalDestroy: vi.fn().mockResolvedValue(undefined),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onTerminalData: vi.fn(() => ({ dispose: vi.fn() })),
    sshConnect: vi.fn().mockResolvedValue({ connected: true }),
    sshCreateShell: vi.fn().mockResolvedValue(undefined),
    sshWriteShell: vi.fn(),
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

async function confirmPendingAction(name: RegExp) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name }));
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
  reason: 'window-close' | 'app-quit' | 'tray-stop' | 'update-install' = 'window-close',
) {
  await waitFor(() => expect(rendererMocks.prepareForCloseHandler).toBeTypeOf('function'));
  await act(async () => {
    await rendererMocks.prepareForCloseHandler!({ requestId, reason });
  });
}

describe('split panes in the app', () => {
  it('opens snippets with the configured shortcut and routes pasted content to the focused terminal', async () => {
    const pasted = vi.fn();
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
    await waitFor(() => expect(screen.getByTestId(/terminal-/)).toHaveFocus());

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
    expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: secondId });
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
    await waitFor(() => expect(screen.getByTestId(/terminal-/)).toHaveFocus());
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
      expect(screen.getByTestId(/terminal-/)).toHaveFocus();
    });
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
      rendererMocks.paletteActions.find((action) => action.id === 'sidebar-settings')!.handler();
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
    await waitFor(() => expect(screen.getByTestId(/terminal-/)).toHaveFocus());
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
    (window.janet.sshCreateShell as any).mockClear();

    await act(async () => {
      await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
    });

    await waitFor(() => {
      expect(window.janet.sshConnect).toHaveBeenCalledTimes(2);
      expect(window.janet.sshCreateShell).toHaveBeenCalledTimes(2);
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
      (window.janet.terminalCreate as any).mockClear();

      await act(async () => {
        await rendererMocks.verticalTabBarProps.onWorkspaceTabLaunch(preset);
      });

      await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1));
      expect(window.janet.sshCreateShell).not.toHaveBeenCalled();
      expect((window.janet.terminalCreate as any).mock.calls[0][0]).not.toHaveProperty('startupCommands');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('restores a saved session with multiple tabs, pane tree, and active tab', async () => {
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
      for (const [params] of projectCreates) {
        expect(params).not.toHaveProperty('startupCommands');
        expect(params).not.toHaveProperty('startupShellDialect');
      }
      expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
    });
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
    expect(shellArgs).not.toHaveProperty('startupCommands');
    expect(shellArgs).not.toHaveProperty('startupShellDialect');
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
    await new Promise((r) => setTimeout(r, 700));

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
      expect(screen.getByTestId(/terminal-/)).toBeInTheDocument();
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
  it('resolves close preparation as saved immediately when no file is dirty', async () => {
    render(<App />);

    await requestWorkspaceClose('clean-close', 'app-quit');

    await waitFor(() => {
      expect(window.janet.resolvePrepareForClose).toHaveBeenCalledWith({
        requestId: 'clean-close',
        resolution: 'saved',
      });
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
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

    await requestWorkspaceClose('discard-close', 'tray-stop');
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
