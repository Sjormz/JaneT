import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import TabBar from './components/TabBar';
import SplitPane from './components/SplitPane';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import CommandPalette, { CommandAction } from './components/CommandPalette';
import {
  TabInfo, SessionInfo,
  PaneNode,
  createLeaf, splitPane, removePane, getAllLeafIds, genId,
} from './types';
import { ThemeName, applyCssTheme, getTheme } from './themes';

export default function App() {
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

  // Settings state
  const [currentTheme, setCurrentTheme] = useState<ThemeName>('tokyo-night');
  const [fontSize, setFontSize] = useState(14);
  const settingsLoadedRef = useRef(false);

  // Load settings on mount
  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;

    try {
      window.jterm.getSettings().then((s: any) => {
        setCurrentTheme(s.theme || 'tokyo-night');
        setFontSize(s.fontSize || 14);
        applyCssTheme(getTheme(s.theme || 'tokyo-night').css);
      }).catch(() => {});
    } catch {}
  }, []);

  // Apply CSS theme whenever it changes
  useEffect(() => {
    const theme = getTheme(currentTheme);
    applyCssTheme(theme.css);
  }, [currentTheme]);

  // Persist settings when changed
  const persistTheme = useCallback((theme: ThemeName) => {
    setCurrentTheme(theme);
    try { window.jterm.setSettings({ theme }).catch(() => {}); } catch {}
  }, []);

  const persistFontSize = useCallback((size: number) => {
    setFontSize(size);
    try { window.jterm.setSettings({ fontSize: size }).catch(() => {}); } catch {}
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

  // Called when a TerminalPane unmounts
  const handleTerminalRemoved = useCallback(
    (termId: string) => {
      setActiveTerminals((prev) => {
        const next = new Set(prev);
        next.delete(termId);
        return next;
      });
      window.jterm.terminalDestroy({ id: termId }).catch(() => {});
    },
    [],
  );

  // === Tab management ===

  const addTab = useCallback(
    (type: 'local' | 'ssh' = 'local', sshSessionId?: string) => {
      const tab: TabInfo = {
        id: genId('tab'),
        title: type === 'local' ? 'terminal' : `ssh-${sshSessionId?.slice(0, 6)}`,
        type,
        sshSessionId,
        root: createLeaf(type),
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [],
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
            window.jterm.terminalDestroy({ id: leafId }).catch(() => {});
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
            title: 'terminal',
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

  // === Command palette keyboard shortcut ===
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setPaletteVisible((v) => !v);
      } else if (e.key === 'Escape' && paletteVisible) {
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
        shortcut: 'Ctrl+N', handler: () => addTab('local'),
      },
      {
        id: 'close-tab', label: 'Close Tab', category: 'Tab',
        shortcut: 'Ctrl+W', handler: () => closeTab(activeTabId),
      },
      {
        id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'View',
        shortcut: 'Ctrl+B', handler: () => setSidebarOpen((v) => !v),
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
        shortcut: 'Ctrl+Plus', handler: () => persistFontSize(Math.min(24, fontSize + 1)),
      },
      {
        id: 'font-decrease', label: 'Decrease Font Size', category: 'Settings',
        shortcut: 'Ctrl+-', handler: () => persistFontSize(Math.max(10, fontSize - 1)),
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
          shortcut: 'Ctrl+\\', handler: () => handleSplitPane(activeTab.id, firstLeaf, 'vertical'),
        });
        actions.push({
          id: 'split-down', label: 'Split Down', category: 'Pane',
          shortcut: 'Ctrl+Shift+\\', handler: () => handleSplitPane(activeTab.id, firstLeaf, 'horizontal'),
        });
        if (leaves.length > 1) {
          actions.push({
            id: 'close-pane', label: 'Close Pane', category: 'Pane',
            shortcut: 'Ctrl+Shift+W', handler: () => handleClosePane(activeTab.id, firstLeaf),
          });
        }
      }
    }

    return actions;
  }, [
    activeTab, activeTabId, addTab, closeTab, handleSplitPane, handleClosePane,
    fontSize, persistFontSize, persistTheme,
  ]);

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onNewTab={() => addTab('local')}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
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
          />
        )}
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
          />
        </div>
      </div>
      <StatusBar
        sshSessions={sshSessions}
        activeTerminalsCount={activeTerminals.size}
      />
      <CommandPalette
        visible={paletteVisible}
        onClose={() => setPaletteVisible(false)}
        actions={paletteActions}
      />
    </div>
  );
}
