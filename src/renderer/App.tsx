import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Titlebar from './components/Titlebar';
import VerticalTabBar from './components/VerticalTabBar';
import SplitPane from './components/SplitPane';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import CommandPalette, { CommandAction } from './components/CommandPalette';
import ShortcutEditor from './components/ShortcutEditor';
import ShellIntegrationHint from './components/ShellIntegrationHint';
import UpdateBanner from './components/UpdateBanner';
import {
  TabInfo, SessionInfo,
  PaneNode,
  createLeaf, splitPane, removePane, getAllLeafIds, genId,
} from './types';
import { ThemeName, applyCssTheme, getTheme } from './themes';
import { KeybindingsProvider, useKeybindings } from './KeybindingsContext';
import { KeybindingAction } from './keybindings';

function AppInner() {
  const [tabs, setTabs] = useState<TabInfo[]>([{
    id: genId('tab'),
    title: 'terminal',
    type: 'local',
    root: createLeaf('local'),
  }]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSection, setSidebarSection] = useState<'files' | 'ssh' | 'git' | 'settings'>('files');
  const [sshSessions, setSshSessions] = useState<SessionInfo[]>([]);
  const [activeTerminals, setActiveTerminals] = useState<Set<string>>(new Set());
  const [paletteVisible, setPaletteVisible] = useState(false);

  // === CWD tracking ===
  // cwdByTerminal: latest known working directory for each terminal,
  //   populated either by the initial cwd passed to node-pty (local
  //   terminals) or by OSC 7 escapes parsed from the PTY output.
  // focusedTerminalId: which terminal pane currently has focus. The
  //   sidebar (file explorer, git tree) follows this terminal's cwd.
  //   Defaults to the first leaf of the active tab so the sidebar is
  //   never blank.
  const [cwdByTerminal, setCwdByTerminal] = useState<Record<string, string>>({});
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);
  // Cached home directory — used as the fallback cwd before any OSC 7
  // has arrived or for SSH tabs.
  const [homeDir, setHomeDir] = useState<string>('');
  useEffect(() => {
    try { window.janet.fsGetHome().then(setHomeDir).catch(() => {}); } catch {}
  }, []);

  // Settings state
  const [currentTheme, setCurrentTheme] = useState<ThemeName>('tokyo-night');
  const [fontSize, setFontSize] = useState(14);
  const settingsLoadedRef = useRef(false);

  const { bindings, setBinding, matches, on } = useKeybindings();

  // Load settings on mount and apply saved keybindings
  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;

    try {
      window.janet.getSettings().then((s: any) => {
        setCurrentTheme(s.theme || 'tokyo-night');
        setFontSize(s.fontSize || 14);
        applyCssTheme(getTheme(s.theme || 'tokyo-night').css);
        // Apply saved keybindings
        if (s.keybindings) {
          for (const [action, shortcut] of Object.entries(s.keybindings)) {
            if (shortcut && typeof shortcut === 'string') {
              setBinding(action as KeybindingAction, shortcut);
            }
          }
        }
      }).catch(() => {});
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply CSS theme whenever it changes
  useEffect(() => {
    const theme = getTheme(currentTheme);
    applyCssTheme(theme.css);
  }, [currentTheme]);

  // Persist settings when changed
  const persistTheme = useCallback((theme: ThemeName) => {
    setCurrentTheme(theme);
    try { window.janet.setSettings({ theme }).catch(() => {}); } catch {}
  }, []);

  const persistFontSize = useCallback((size: number) => {
    setFontSize(size);
    try { window.janet.setSettings({ fontSize: size }).catch(() => {}); } catch {}
  }, []);

  // Persist keybindings when they change
  const handleKeybindingsChange = useCallback((newBindings: Record<KeybindingAction, string>) => {
    try { window.janet.setSettings({ keybindings: newBindings }).catch(() => {}); } catch {}
  }, []);

  const getTab = useCallback(
    (tabId: string) => tabs.find((t) => t.id === tabId) || tabs[0],
    [tabs],
  );

  const updateTab = useCallback(
    (tabId: string, updater: (tab: TabInfo) => TabInfo) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? updater(t) : t)),
      );
    },
    [],
  );

  // Track terminal registrations
  const handleTerminalReady = useCallback((termId: string) => {
    setActiveTerminals((prev) => new Set(prev).add(termId));
  }, []);

  // Called by TerminalPane when the shell reports a new cwd (via OSC 7
  // parsed from the PTY stream). Only the focused terminal's cwd drives
  // the sidebar, but we still store the cwd for every terminal so that
  // switching focus is instant.
  const handleCwdChange = useCallback((termId: string, cwd: string) => {
    setCwdByTerminal((prev) => {
      if (prev[termId] === cwd) return prev;
      return { ...prev, [termId]: cwd };
    });
  }, []);

  // Called by TerminalPane when a terminal gains focus. We track this
  // so the sidebar can react when the user clicks between split panes.
  const handleTerminalFocus = useCallback((termId: string) => {
    setFocusedTerminalId(termId);
  }, []);

  // Called when a TerminalPane unmounts
  const handleTerminalRemoved = useCallback(
    (termId: string) => {
      setActiveTerminals((prev) => {
        const next = new Set(prev);
        next.delete(termId);
        return next;
      });
      window.janet.terminalDestroy({ id: termId }).catch(() => {});
    },
    [],
  );

  // === Tab management ===

  const addTab = useCallback(
    (type: 'local' | 'ssh' = 'local', sshSessionId?: string) => {
      const tab: TabInfo = {
        id: genId('tab'),
        title: type === 'local' ? `terminal ${tabs.length + 1}` : `ssh-${sshSessionId?.slice(0, 6)}`,
        type,
        sshSessionId,
        root: createLeaf(type),
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [tabs.length],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (prev.length <= 1) return prev;
        const filtered = prev.filter((t) => t.id !== tabId);

        const tab = prev.find((t) => t.id === tabId);
        if (tab) {
          for (const leafId of getAllLeafIds(tab.root)) {
            window.janet.terminalDestroy({ id: leafId }).catch(() => {});
          }
        }

        if (activeTabId === tabId) {
          const newIdx = Math.min(idx, filtered.length - 1);
          setActiveTabId(filtered[newIdx].id);
        }
        return filtered;
      });
    },
    [activeTabId],
  );

  // === Split / close pane ===

  const handleSplitPane = useCallback(
    (tabId: string, leafId: string, direction: 'horizontal' | 'vertical') => {
      updateTab(tabId, (tab) => ({
        ...tab,
        root: splitPane(tab.root, leafId, direction),
      }));
    },
    [updateTab],
  );

  const handleClosePane = useCallback(
    (tabId: string, leafId: string) => {
      updateTab(tabId, (tab) => {
        const newRoot = removePane(tab.root, leafId);
        if (!newRoot) {
          closeTab(tabId);
          return tab;
        }
        return { ...tab, root: newRoot };
      });
    },
    [updateTab, closeTab],
  );

  // === SSH session management ===

  const handleSSHConnected = useCallback(
    (session: SessionInfo) => {
      setSshSessions((prev) => [...prev, session]);
      addTab('ssh', session.id);
    },
    [addTab],
  );

  const handleSSHDisconnected = useCallback(
    (sessionId: string) => {
      setSshSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setTabs((prev) => {
        const remaining = prev.filter((t) => t.sshSessionId !== sessionId);
        if (remaining.length === 0) {
          const newTab: TabInfo = {
            id: genId('tab'),
            title: 'terminal 1',
            type: 'local',
            root: createLeaf('local'),
          };
          setActiveTabId(newTab.id);
          return [newTab];
        }
        if (!remaining.find((t) => t.id === activeTabId)) {
          setActiveTabId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeTabId],
  );

  const activeTab = getTab(activeTabId);

  // The terminal pane whose cwd should drive the sidebar. If the user
  // has explicitly focused a terminal, use that; otherwise fall back to
  // the first leaf of the active tab so the sidebar is never blank.
  const sidebarTerminalId = useMemo(() => {
    if (focusedTerminalId && getAllLeafIds(activeTab.root).includes(focusedTerminalId)) {
      return focusedTerminalId;
    }
    const leaves = getAllLeafIds(activeTab.root);
    return leaves[0] ?? null;
  }, [focusedTerminalId, activeTab]);

  // The effective cwd: prefer the focused terminal's last-known cwd, fall
  // back to the home dir. SSH terminals always show "~" since we can't
  // resolve a remote cwd into a local file tree.
  const effectiveCwd = useMemo(() => {
    if (activeTab.type === 'ssh') return homeDir;
    if (sidebarTerminalId && cwdByTerminal[sidebarTerminalId]) {
      return cwdByTerminal[sidebarTerminalId];
    }
    return homeDir;
  }, [activeTab, sidebarTerminalId, cwdByTerminal, homeDir]);

  // === Keyboard shortcuts via keybindings context ===
  // Register global action handlers
  useEffect(() => {
    const unsub1 = on('palette-toggle', () => {
      setPaletteVisible((v) => !v);
    });
    const unsub2 = on('new-terminal', () => addTab('local'));
    const unsub3 = on('close-tab', () => closeTab(activeTabId));
    const unsub4 = on('toggle-sidebar', () => setSidebarOpen((v) => !v));
    const unsub5 = on('font-increase', () => persistFontSize(Math.min(24, fontSize + 1)));
    const unsub6 = on('font-decrease', () => persistFontSize(Math.max(10, fontSize - 1)));
    return () => {
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6();
    };
  }, [on, addTab, closeTab, activeTabId, persistFontSize, fontSize]);

  // Split/close-pane handlers depend on activeTab so register separately
  useEffect(() => {
    const unsub1 = on('split-right', () => {
      if (!activeTab) return;
      const leaves = getAllLeafIds(activeTab.root);
      if (leaves.length > 0) handleSplitPane(activeTab.id, leaves[0], 'vertical');
    });
    const unsub2 = on('split-down', () => {
      if (!activeTab) return;
      const leaves = getAllLeafIds(activeTab.root);
      if (leaves.length > 0) handleSplitPane(activeTab.id, leaves[0], 'horizontal');
    });
    const unsub3 = on('close-pane', () => {
      if (!activeTab) return;
      const leaves = getAllLeafIds(activeTab.root);
      if (leaves.length > 1) handleClosePane(activeTab.id, leaves[0]);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [on, activeTab, handleSplitPane, handleClosePane]);

  // === Escape handler for palette ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && paletteVisible) {
        setPaletteVisible(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [paletteVisible]);

  // === Command palette actions ===
  const paletteActions = useMemo<CommandAction[]>(() => {
    const actions: CommandAction[] = [
      {
        id: 'new-terminal', label: 'New Terminal', category: 'Tab',
        shortcut: bindings['new-terminal'], handler: () => addTab('local'),
      },
      {
        id: 'close-tab', label: 'Close Tab', category: 'Tab',
        shortcut: bindings['close-tab'], handler: () => closeTab(activeTabId),
      },
      {
        id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'View',
        shortcut: bindings['toggle-sidebar'], handler: () => setSidebarOpen((v) => !v),
      },
      {
        id: 'sidebar-files', label: 'Show File Explorer', category: 'View',
        handler: () => { setSidebarOpen(true); setSidebarSection('files'); },
      },
      {
        id: 'sidebar-ssh', label: 'Show SSH Connections', category: 'View',
        handler: () => { setSidebarOpen(true); setSidebarSection('ssh'); },
      },
      {
        id: 'sidebar-git', label: 'Show Git Tree', category: 'View',
        handler: () => { setSidebarOpen(true); setSidebarSection('git'); },
      },
      {
        id: 'sidebar-settings', label: 'Show Settings', category: 'View',
        handler: () => { setSidebarOpen(true); setSidebarSection('settings'); },
      },
      {
        id: 'font-increase', label: 'Increase Font Size', category: 'Settings',
        shortcut: bindings['font-increase'], handler: () => persistFontSize(Math.min(24, fontSize + 1)),
      },
      {
        id: 'font-decrease', label: 'Decrease Font Size', category: 'Settings',
        shortcut: bindings['font-decrease'], handler: () => persistFontSize(Math.max(10, fontSize - 1)),
      },
      {
        id: 'search-toggle', label: 'Search in Terminal', category: 'Terminal',
        shortcut: bindings['search-toggle'], handler: () => {},
      },
      {
        id: 'palette-toggle', label: 'Command Palette', category: 'General',
        shortcut: bindings['palette-toggle'], handler: () => setPaletteVisible((v) => !v),
      },
      {
        id: 'check-updates', label: 'Check for Updates', category: 'General',
        handler: () => { window.janet.checkForUpdates().catch(() => {}); },
      },
      {
        id: 'theme-tokyo-night', label: 'Theme: Tokyo Night', category: 'Theme',
        handler: () => persistTheme('tokyo-night'),
      },
      {
        id: 'theme-dracula', label: 'Theme: Dracula', category: 'Theme',
        handler: () => persistTheme('dracula'),
      },
      {
        id: 'theme-one-dark', label: 'Theme: One Dark', category: 'Theme',
        handler: () => persistTheme('one-dark'),
      },
      {
        id: 'theme-solarized-light', label: 'Theme: Solarized Light', category: 'Theme',
        handler: () => persistTheme('solarized-light'),
      },
      {
        id: 'theme-gruvbox', label: 'Theme: Gruvbox', category: 'Theme',
        handler: () => persistTheme('gruvbox'),
      },
    ];

    // Add split actions for active tab panes
    if (activeTab) {
      const leaves = getAllLeafIds(activeTab.root);
      if (leaves.length > 0) {
        const firstLeaf = leaves[0];
        actions.push({
          id: 'split-right', label: 'Split Right', category: 'Pane',
          shortcut: bindings['split-right'], handler: () => handleSplitPane(activeTab.id, firstLeaf, 'vertical'),
        });
        actions.push({
          id: 'split-down', label: 'Split Down', category: 'Pane',
          shortcut: bindings['split-down'], handler: () => handleSplitPane(activeTab.id, firstLeaf, 'horizontal'),
        });
        if (leaves.length > 1) {
          actions.push({
            id: 'close-pane', label: 'Close Pane', category: 'Pane',
            shortcut: bindings['close-pane'], handler: () => handleClosePane(activeTab.id, firstLeaf),
          });
        }
      }
    }

    return actions;
  }, [
    activeTab, activeTabId, addTab, closeTab, handleSplitPane, handleClosePane,
    fontSize, persistFontSize, persistTheme, bindings,
  ]);

  return (
    <div className="app">
      <Titlebar
        section={sidebarSection}
        onSectionChange={(section) => {
          if (section === sidebarSection && sidebarOpen) {
            setSidebarOpen(false);
          } else {
            setSidebarSection(section);
            setSidebarOpen(true);
          }
        }}
        sidebarOpen={sidebarOpen}
        onNewTab={() => addTab('local')}
        onOpenPalette={() => setPaletteVisible(true)}
      />
      <div className="app-body">
        {sidebarOpen && (
          <Sidebar
            section={sidebarSection}
            onSectionChange={setSidebarSection}
            sshSessions={sshSessions}
            onSSHConnected={handleSSHConnected}
            onSSHDisconnected={handleSSHDisconnected}
            currentTheme={currentTheme}
            onThemeChange={persistTheme}
            fontSize={fontSize}
            onFontSizeChange={persistFontSize}
            shortcutEditor={<ShortcutEditor />}
            cwd={effectiveCwd}
            cwdReady={Boolean(effectiveCwd)}
            isRemote={activeTab.type === 'ssh'}
            shellIntegrationHint={<ShellIntegrationHint />}
          />
        )}
        <VerticalTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={closeTab}
          onNewTab={() => addTab('local')}
        />
        <div className="terminal-area">
          <SplitPane
            node={activeTab.root}
            tabId={activeTab.id}
            tabType={activeTab.type}
            sshSessionId={activeTab.sshSessionId}
            onTerminalReady={handleTerminalReady}
            onTerminalRemoved={handleTerminalRemoved}
            onSplitPane={(leafId, dir) => handleSplitPane(activeTab.id, leafId, dir)}
            onClosePane={(leafId) => handleClosePane(activeTab.id, leafId)}
            themeName={currentTheme}
            fontSize={fontSize}
            onCwdChange={handleCwdChange}
            onTerminalFocus={handleTerminalFocus}
            initialCwd={homeDir || undefined}
          />
        </div>
      </div>
      <StatusBar
        sshSessions={sshSessions}
        activeTerminalsCount={activeTerminals.size}
        cwd={effectiveCwd}
        isRemote={activeTab.type === 'ssh'}
        remoteHost={activeTab.type === 'ssh'
          ? sshSessions.find((s) => s.id === activeTab.sshSessionId)?.host
          : undefined}
      />
      <CommandPalette
        visible={paletteVisible}
        onClose={() => setPaletteVisible(false)}
        actions={paletteActions}
      />
      <UpdateBanner />
    </div>
  );
}

export default function App() {
  const [bindings, setBindings] = useState<Record<KeybindingAction, string> | null>(null);

  // Load saved keybindings from settings before rendering
  useEffect(() => {
    try {
      window.janet.getSettings().then((s: any) => {
        if (s.keybindings) {
          setBindings(s.keybindings as Record<KeybindingAction, string>);
        } else {
          setBindings({} as Record<KeybindingAction, string>);
        }
      }).catch(() => setBindings({} as Record<KeybindingAction, string>));
    } catch {
      setBindings({} as Record<KeybindingAction, string>);
    }
  }, []);

  // Persist keybindings to main process
  const handleSave = useCallback((b: Record<KeybindingAction, string>) => {
    try { window.janet.setSettings({ keybindings: b }).catch(() => {}); } catch {}
  }, []);

  // Don't render until bindings are loaded (avoids flash of defaults)
  if (!bindings) return null;

  return (
    <KeybindingsProvider initialBindings={bindings} onSave={handleSave}>
      <AppInner />
    </KeybindingsProvider>
  );
}
