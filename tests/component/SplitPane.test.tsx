import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/renderer/App';

const mountedTermIds: string[] = [];

vi.mock('../../src/renderer/components/Titlebar', () => ({
  default: () => <div data-testid="titlebar" />,
}));
vi.mock('../../src/renderer/components/VerticalTabBar', () => ({
  default: () => <div data-testid="vertical-tab-bar" />,
}));
vi.mock('../../src/renderer/components/Sidebar', () => ({
  default: () => <div data-testid="sidebar" />,
}));
vi.mock('../../src/renderer/components/StatusBar', () => ({
  default: () => <div data-testid="statusbar" />,
}));
vi.mock('../../src/renderer/components/CommandPalette', () => ({
  default: () => null,
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
    onReady,
    onRemoved,
  }: {
    termId: string;
    hasSession?: boolean;
    initialCwd?: string;
    tabType?: 'local' | 'ssh';
    sshSessionId?: string;
    sshShellReady?: boolean;
    onReady?: (id: string) => void;
    onRemoved?: (id: string) => void;
  }) {
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

    return <div data-testid={`terminal-${termId}`}>{termId}</div>;
  }

  return { default: MockTerminalPane, disposeCachedTerminal: vi.fn() };
});

beforeEach(() => {
  mountedTermIds.length = 0;
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
    sshDisconnect: vi.fn().mockResolvedValue(undefined),
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
  });

  it('restores a saved SSH tab, connects it, then binds a single shell', async () => {
    const sshProfileId = 'pckpr@box.local:22:password';
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
      sshProfiles: [{
        id: sshProfileId,
        host: 'box.local',
        port: 22,
        username: 'pckpr',
        auth: 'password',
        password: 'secret',
      }],
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

    resolveConnect?.({ connected: true });

    await waitFor(() => {
      expect(window.janet.sshCreateShell).toHaveBeenCalledTimes(1);
    });

    const connectArgs = (window.janet.sshConnect as any).mock.calls[0][0] as any;
    const shellArgs = (window.janet.sshCreateShell as any).mock.calls[0][0] as any;
    expect(connectArgs.id).toBeTruthy();
    expect(shellArgs.id).toBe(connectArgs.id);
    expect(shellArgs.id).toBe(connectArgs.id);
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
