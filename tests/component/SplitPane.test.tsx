import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/renderer/App';

const mountedTermIds: string[] = [];
const rendererMocks = vi.hoisted(() => ({
  disposeCachedTerminal: vi.fn(),
  paletteActions: [] as Array<{ id: string; handler: () => void }>,
  sidebarProps: null as any,
  sshConnectionClosedHandler: null as null | ((event: { id: string; reason: string }) => void),
  sshRetryHandlers: new Map<string, (
    termId: string,
    dimensions: { cols: number; rows: number },
  ) => void | Promise<void>>(),
}));

vi.mock('../../src/renderer/components/Titlebar', () => ({
  default: () => <div data-testid="titlebar" />,
}));
vi.mock('../../src/renderer/components/VerticalTabBar', () => ({
  default: () => <div data-testid="vertical-tab-bar" />,
}));
vi.mock('../../src/renderer/components/Sidebar', () => ({
  default: (props: unknown) => {
    rendererMocks.sidebarProps = props;
    return <div data-testid="sidebar" />;
  },
}));
vi.mock('../../src/renderer/components/StatusBar', () => ({
  default: ({ activeTerminalsCount, sshSessions }: {
    activeTerminalsCount: number;
    sshSessions: unknown[];
  }) => (
    <div
      data-testid="statusbar"
      data-terminal-count={activeTerminalsCount}
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
            window.janet.sshCreateShell({ id: sshSessionId, termId, cols: 80, rows: 24 });
            onReady?.(termId);
          }
        } else if (tabType === 'local') {
          window.janet.terminalCreate({ id: termId, cwd: initialCwd });
          onReady?.(termId);
        } else {
          onReady?.(termId);
          return;
        }
      } else {
        onReady?.(termId);
      }
    }, [termId, hasSession, initialCwd, tabType, sshSessionId, sshShellReady, onReady]);

    return (
      <div
        data-testid={`terminal-${termId}`}
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
  rendererMocks.sidebarProps = null;
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
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
  };
});

describe('split panes in the app', () => {
  it('keeps existing terminals alive when splitting deeper panes', async () => {
    render(<App />);

    const splitButton = await screen.findByRole('button', { name: /split right/i });
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

    const splitButtons = screen.getAllByRole('button', { name: /split right/i });
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

    await screen.findByRole('button', { name: /split right/i });
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));
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

    await screen.findByRole('button', { name: /split right/i });
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    // Close the second pane
    const closeButtons = screen.getAllByRole('button', { name: /close pane/i });
    fireEvent.click(closeButtons[1]);

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1));

    // Survivor must be sized from React state, not from stale inline styles.
    const survivor = document.querySelector<HTMLElement>('.split-child');
    expect(survivor).toBeTruthy();
    expect(survivor!.style.flex).toBe('1 1 0%');
  });

  it('applies the close-pane shortcut to the focused pane', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split right/i });
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));
    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    const [firstTerminal, secondTerminal] = screen.getAllByTestId(/terminal-/);
    const firstId = firstTerminal.textContent!;
    const secondId = secondTerminal.textContent!;
    fireEvent.focus(secondTerminal);
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/).map((terminal) => terminal.textContent)).toEqual([firstId]);
    });
    expect(window.janet.terminalDestroy).toHaveBeenCalledWith({ id: secondId });
  });

  it('applies the command-palette close action to the focused pane', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split right/i });
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));
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
      await screen.findByRole('button', { name: /split right/i });
      fireEvent.click(screen.getByRole('button', { name: /split right/i }));
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

  it('shows a recoverable startup state when settings cannot be loaded', async () => {
    window.janet.getSettings = vi.fn().mockRejectedValue(new Error('settings unavailable'));

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'JaneT could not load your workspace settings.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use defaults' }));
    expect(await screen.findByTestId('titlebar')).toBeInTheDocument();
  });

  it('maximizes a single pane within the terminal area and restores it to the split layout', async () => {
    render(<App />);

    await screen.findByRole('button', { name: /split right/i });
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));

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

    await screen.findByRole('button', { name: /split right/i });
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));

    await waitFor(() => expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2));

    fireEvent.click(screen.getAllByRole('button', { name: /maximize pane/i })[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
      expect(screen.getByRole('button', { name: /restore pane layout/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /close pane/i }));

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /restore pane layout/i })).toBeNull();
    expect(screen.getByRole('button', { name: /maximize pane/i })).toBeInTheDocument();
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

    // Active tab is `project` (2-leaf split) — we should see 2 terminals
    // both created with the cwd saved in the session, proving the
    // restored tree (not the starter) is what's mounted.
    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(2);
    });

    const projectCreates = (window.janet.terminalCreate as any).mock.calls.filter(
      (call: any[]) => call[0]?.cwd === 'C:/repo',
    );
    expect(projectCreates).toHaveLength(2);
    expect(window.janet.terminalCreate).toHaveBeenCalledTimes(2);
  });

  it('restores a saved SSH tab, connects it, then binds a single shell', async () => {
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
            root: { type: 'leaf' },
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
    expect(connectArgs.id).toBeTruthy();
    expect(shellArgs.id).toBe(connectArgs.id);
    expect(rendererMocks.sidebarProps.explorerSource).toEqual(expect.objectContaining({
      kind: 'ssh',
      sessionId: connectArgs.id,
      connectionState: 'ready',
      ready: true,
    }));

    act(() => {
      rendererMocks.sidebarProps.onSSHProfilesChange([{ ...profile, host: 'renamed-box.local' }]);
    });
    await waitFor(() => {
      expect(rendererMocks.sidebarProps.sshProfiles[0].host).toBe('renamed-box.local');
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
          root: { type: 'leaf', terminalType: 'ssh', sshProfileId: 'removed-profile' },
        }],
        activeTabId: 'missing-ssh',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

    await waitFor(() => expect(window.janet.terminalCreate).toHaveBeenCalledTimes(1));
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
    window.janet.getSettings = vi.fn().mockResolvedValue({
      keybindings: {},
      workspaceTabs: [],
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'mixed',
        auth: 'password',
        password: 'secret',
      }],
      session: {
        tabs: [{
          id: 'mixed-workspace-retry',
          title: 'mixed retry',
          type: 'local',
          root: {
            type: 'split',
            direction: 'vertical',
            sizes: [1, 1],
            children: [
              { type: 'leaf', terminalType: 'local' },
              { type: 'leaf', terminalType: 'ssh', sshProfileId },
            ],
          },
        }],
        activeTabId: 'mixed-workspace-retry',
        sidebarOpen: true,
        tabsOpen: true,
        sidebarSection: 'files',
      },
    });

    render(<App />);

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
    });
    expect(window.janet.sshCreateShell).toHaveBeenNthCalledWith(2, {
      id: initialShell.id,
      termId: initialShell.termId,
      cols: 132,
      rows: 48,
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

    fireEvent.click(screen.getByRole('button', { name: /close pane/i }));
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
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-terminal-count', '2');
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-ssh-count', '1');
    });

    const sessionId = (window.janet.sshConnect as any).mock.calls[0][0].id as string;
    const secondId = screen.getAllByTestId(/terminal-/)[1].textContent!;
    fireEvent.click(screen.getAllByRole('button', { name: /close pane/i })[1]);

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-/)).toHaveLength(1);
      expect(window.janet.sshDestroyShell).toHaveBeenCalledWith({ sessionId, termId: secondId });
      expect(rendererMocks.disposeCachedTerminal).toHaveBeenCalledWith(secondId);
      expect(screen.getByTestId('statusbar')).toHaveAttribute('data-terminal-count', '1');
    });
    expect(window.janet.sshDisconnect).not.toHaveBeenCalled();

    const remainingId = screen.getByTestId(/terminal-/).textContent!;
    fireEvent.click(screen.getByRole('button', { name: /close pane/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /split right/i }));

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
