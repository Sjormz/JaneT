import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Titlebar from './components/Titlebar';
import VerticalTabBar from './components/VerticalTabBar';
import SplitPane from './components/SplitPane';
import { disposeCachedTerminal } from './components/TerminalPane';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import CommandPalette, { CommandAction } from './components/CommandPalette';
import ShortcutEditor from './components/ShortcutEditor';
import UpdateBanner from './components/UpdateBanner';
import {
  TabInfo, SessionInfo,
  SavedSSHProfile,
  WorkspaceTabPreset,
  PaneNode, PaneDropSide,
  createPaneRoot, splitPane, removePane, movePane, resizePane, getAllLeafIds, genId,
} from './types';
import { ThemeName, applyCssTheme, getTheme } from './themes';
import { KeybindingsProvider, useKeybindings } from './KeybindingsContext';
import { KeybindingAction } from './keybindings';
import { serializePaneTree, restorePaneTree, normalizeSession, SavedSession } from './sessionRestore';
import { GitStatusSummary, summarizeGitStatus } from './gitStatus';

function createTabRoot(type: 'local' | 'ssh'): PaneNode {
  return createPaneRoot(type, 1, 'vertical');
}

function ensureSplitRoot(root: PaneNode): PaneNode {
  if (root.type === 'leaf') {
    return {
      id: genId('split'),
      type: 'split',
      direction: 'vertical',
      children: [root],
      sizes: [1],
    };
  }
  return root;
}

function AppInner() {
  // Default starter tab — used only when no session has been restored.
  const starterTab: TabInfo = useMemo(() => ({
    id: genId('tab'),
    title: 'terminal',
    type: 'local',
    root: createTabRoot('local'),
  }), []);

  const [tabs, setTabs] = useState<TabInfo[]>([starterTab]);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [activeTabId, setActiveTabId] = useState(starterTab.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tabsOpen, setTabsOpen] = useState(true);
  const [sidebarSection, setSidebarSection] = useState<'files' | 'ssh' | 'git' | 'settings'>('files');
  const [sshSessions, setSshSessions] = useState<SessionInfo[]>([]);
  const [readySshSessionIds, setReadySshSessionIds] = useState<Set<string>>(new Set());
  const [sshProfiles, setSshProfiles] = useState<SavedSSHProfile[]>([]);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabPreset[]>([]);
  const [maximizedLeafByTab, setMaximizedLeafByTab] = useState<Record<string, string | null>>({});
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [paneDropTarget, setPaneDropTarget] = useState<{ leafId: string; side: PaneDropSide } | null>(null);
  const [activeTerminals, setActiveTerminals] = useState<Set<string>>(new Set());
  const liveTerminalIdsRef = useRef<Set<string>>(new Set());
  const workspaceTabsRestoredRef = useRef(false);
  const sessionRestoredRef = useRef(false);
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
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);
  useEffect(() => {
    try { window.janet.fsGetHome().then(setHomeDir).catch(() => {}); } catch {}
  }, []);

  // Settings state
  const [currentTheme, setCurrentTheme] = useState<ThemeName>('tokyo-night');
  const [fontSize, setFontSize] = useState(14);
  const [sidebarSide, setSidebarSide] = useState<'left' | 'right'>('left');
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
        setSidebarSide(s.sidebarSide === 'right' ? 'right' : 'left');
        setSshProfiles(Array.isArray(s.sshProfiles) ? s.sshProfiles : []);
        setWorkspaceTabs(Array.isArray(s.workspaceTabs) ? s.workspaceTabs : []);
        applyCssTheme(getTheme(s.theme || 'tokyo-night').css);

        // Restore the last open workspace (tabs + active tab + sidebar UI).
        // We do this in the same effect as the rest of settings so a single
        // round-trip handles everything; both the first paint and the
        // session shape are available here.
        if (!sessionRestoredRef.current) {
          sessionRestoredRef.current = true;
          const session = normalizeSession(s.session);
          if (session.tabs.length > 0) {
            const restored: TabInfo[] = [];
            let restoredActiveId: string | null = null;
            for (const saved of session.tabs) {
              const tree = restorePaneTree(saved.root);
              if (!tree) continue;
              const tab: TabInfo = {
                id: genId('tab'),
                title: saved.title,
                type: saved.type,
                cwd: saved.cwd,
                sshProfileId: saved.sshProfileId,
                // For SSH tabs, pre-allocate a session id so the
                // TerminalPane mounts with a stable `sshSessionId` prop.
                // Otherwise the pane would mount with `undefined`,
                // create a dangling xterm with no shell bound, and
                // then have to be torn down + rebuilt when the
                // reconnect effect eventually fills in the id —
                // leaving the user with a blank pane for a beat (or
                // permanently, if any data arrived in between).
                sshSessionId: saved.type === 'ssh' && saved.sshProfileId
                  ? `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                  : undefined,
                sshShellReady: saved.type !== 'ssh',
                root: tree,
              };
              restored.push(tab);
              if (saved.id === session.activeTabId) restoredActiveId = tab.id;
            }
            if (restored.length > 0) {
              setTabs(restored);
              setActiveTabId(restoredActiveId ?? restored[0].id);
            }
          }
          setSidebarOpen(session.sidebarOpen);
          setTabsOpen(session.tabsOpen);
          setSidebarSection(session.sidebarSection);
        }

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

  // Reconnect SSH tabs that were restored from the saved session.
  // The tree is rebuilt with fresh leaf ids during restore, and the
  // session id is pre-allocated so the TerminalPane mounts with a
  // stable `sshSessionId` prop. The transport is still dead though
  // (it's a fresh app start) — so this effect kicks off `ssh:connect`
  // on the pre-allocated id, registers the session for the sidebar
  // status, and surfaces any connect error to the user.
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    if (tabsRef.current.length === 0) return;

    const reconnectable = tabsRef.current.filter(
      (tab) => tab.type === 'ssh' && tab.sshSessionId && tab.sshProfileId,
    );
    if (reconnectable.length === 0) return;

    for (const tab of reconnectable) {
      const profile = sshProfiles.find((candidate) => candidate.id === tab.sshProfileId);
      if (!profile) {
        // Profile was deleted — demote the tab to a plain local tab so
        // the user isn't stuck staring at a dead "Reconnect" panel.
        setTabs((prev) => prev.map((existing) =>
          existing.id === tab.id
            ? { ...existing, type: 'local' as const, sshSessionId: undefined, sshProfileId: undefined }
            : existing,
        ));
        continue;
      }
      const sessionId = tab.sshSessionId!;
      window.janet.sshConnect({
        id: sessionId,
        host: profile.host,
        port: profile.port,
        ...(profile.username ? { username: profile.username } : {}),
        auth: profile.auth,
        password: profile.auth === 'password' ? profile.password : undefined,
        privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
      }).then(() => {
        const session: SessionInfo = {
          id: sessionId,
          host: profile.host,
          port: profile.port,
          ...(profile.username ? { username: profile.username } : {}),
          sshProfileId: profile.id,
        };
        setSshSessions((prev) => prev.some((s) => s.id === sessionId) ? prev : [...prev, session]);
        setReadySshSessionIds((prev) => new Set(prev).add(sessionId));
        setTabs((prev) => prev.map((existing) => (
          existing.id === tab.id ? { ...existing, sshShellReady: true } : existing
        )));
      }).catch((err) => {
        console.error('Failed to reconnect saved SSH tab:', err);
        // Drop the session id so the TerminalPane's error path (or
        // user's manual retry) can re-allocate a fresh one if they
        // choose to recover. Demote to local so the user at least
        // sees content (a local shell) rather than a permanently
        // blank pane with a dead SSH banner.
        setTabs((prev) => prev.map((existing) =>
          existing.id === tab.id
            ? { ...existing, type: 'local' as const, sshSessionId: undefined, sshProfileId: undefined }
            : existing,
        ));
      });
    }
  }, [sshProfiles]);

  // === Persist session state on changes (debounced) ===
  // We debounce so a burst of splits/renames doesn't hammer disk. Saves
  // only fire after the user settles for ~500ms.
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    const timer = setTimeout(() => {
      const savedTabs = tabsRef.current.map((tab) => ({
        id: tab.id,
        title: tab.title,
        type: tab.type,
        cwd: tab.cwd,
        sshProfileId: tab.sshProfileId,
        root: serializePaneTree(tab.root, cwdByTerminal),
      }));
      const session: SavedSession = {
        tabs: savedTabs,
        activeTabId,
        sidebarOpen,
        tabsOpen,
        sidebarSection,
      };
      try { window.janet.setSettings({ session }).catch(() => {}); } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId, sidebarOpen, tabsOpen, sidebarSection]);

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

  const persistSidebarSide = useCallback((side: 'left' | 'right') => {
    setSidebarSide(side);
    try { window.janet.setSettings({ sidebarSide: side }).catch(() => {}); } catch {}
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
    liveTerminalIdsRef.current.add(termId);
    setActiveTerminals(new Set(liveTerminalIdsRef.current));
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
      window.setTimeout(() => {
        const stillRendered = tabsRef.current.some((tab) => getAllLeafIds(tab.root).includes(termId));
        if (stillRendered) return;

        liveTerminalIdsRef.current.delete(termId);
        setActiveTerminals(new Set(liveTerminalIdsRef.current));
        disposeCachedTerminal(termId);
        window.janet.terminalDestroy({ id: termId }).catch(() => {});
      }, 0);
    },
    [],
  );

  // === Tab management ===

  const addTab = useCallback(
    (
      type: 'local' | 'ssh' = 'local',
      sshSessionId?: string,
      sshShellReady = type !== 'ssh',
      sshProfileId?: string,
      cwd?: string,
      title?: string,
    ) => {
      const tab: TabInfo = {
        id: genId('tab'),
        title: title || (type === 'local' ? `terminal ${tabs.length + 1}` : `ssh-${sshSessionId?.slice(0, 6)}`),
        type,
        sshSessionId,
        sshProfileId,
        sshShellReady,
        cwd,
        root: createTabRoot(type),
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    },
    [tabs.length],
  );

  const openLocalTabAt = useCallback((cwd: string, title?: string) => {
    addTab('local', undefined, true, undefined, cwd, title);
  }, [addTab]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const tab = prev.find((t) => t.id === tabId);
        if (!tab) return prev;

        for (const leafId of getAllLeafIds(tab.root)) {
          window.janet.terminalDestroy({ id: leafId }).catch(() => {});
        }

        if (prev.length <= 1) {
          const newTab: TabInfo = {
            id: genId('tab'),
            title: 'terminal',
            type: 'local',
            root: createTabRoot('local'),
          };
          setActiveTabId(newTab.id);
          return [newTab];
        }

        const filtered = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const newIdx = Math.min(idx, filtered.length - 1);
          setActiveTabId(filtered[newIdx].id);
        }
        return filtered;
      });
    },
    [activeTabId],
  );

  const renameTab = useCallback((tabId: string, title: string) => {
    if (!title) return;
    updateTab(tabId, (tab) => ({ ...tab, title }));
  }, [updateTab]);

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

  const handleToggleMaximizePane = useCallback((tabId: string, leafId: string) => {
    setMaximizedLeafByTab((prev) => ({
      ...prev,
      [tabId]: prev[tabId] === leafId ? null : leafId,
    }));
  }, []);

  const handleClosePane = useCallback(
    (tabId: string, leafId: string) => {
      const wasMaximized = maximizedLeafByTab[tabId] === leafId;
      updateTab(tabId, (tab) => {
        const newRoot = removePane(tab.root, leafId);
        if (!newRoot) {
          closeTab(tabId);
          return tab;
        }
        return { ...tab, root: ensureSplitRoot(newRoot) };
      });
      if (wasMaximized) {
        setMaximizedLeafByTab((prev) => ({ ...prev, [tabId]: null }));
      }
    },
    [updateTab, closeTab, maximizedLeafByTab],
  );

  const handleResizePane = useCallback(
    (tabId: string, splitId: string, dividerIndex: number, leftFraction: number) => {
      updateTab(tabId, (tab) => ({
        ...tab,
        root: resizePane(tab.root, splitId, dividerIndex, leftFraction),
      }));
    },
    [updateTab],
  );

  const handleMovePane = useCallback((tabId: string, draggedLeafId: string, targetLeafId: string, side: PaneDropSide) => {
    updateTab(tabId, (tab) => ({ ...tab, root: movePane(tab.root, draggedLeafId, targetLeafId, side) }));
    setDraggedPaneId(null);
    setPaneDropTarget(null);
  }, [updateTab]);

  // === SSH session management ===

  const handleSSHConnected = useCallback(
    (session: SessionInfo) => {
      setSshSessions((prev) => (
        prev.some((s) => s.id === session.id) ? prev : [...prev, session]
      ));
      setReadySshSessionIds((prev) => new Set(prev).add(session.id));
      addTab('ssh', session.id, true, session.sshProfileId);
    },
    [addTab],
  );

  // Re-open the SSH shell for a single term. Triggered by the
  // "Reconnect" button on the SSH notice. If the underlying SSH
  // session is gone (server closed the connection), reconnect the
  // session first using the tab's saved profile.
  const handleSshRetry = useCallback(async (termId: string) => {
    const tab = tabsRef.current.find(
      (candidate) => candidate.type === 'ssh' && getAllLeafIds(candidate.root).includes(termId),
    );
    if (!tab || !tab.sshSessionId) return;

    const dims = (() => {
      // Best-effort — falls back to 80x24 if the term isn't measured yet.
      const el = document.querySelector(`[data-terminal-id="${termId}"]`);
      if (!el) return { cols: 80, rows: 24 };
      return { cols: 80, rows: 24 };
    })();

    try {
      await window.janet.sshCreateShell({ id: tab.sshSessionId, termId, ...dims });
    } catch (shellErr) {
      // Shell open failed — the session itself may be dead. Try
      // re-establishing the SSH connection from the saved profile,
      // then re-open the shell. If the profile is missing the user
      // will see the original error and can dismiss the tab.
      const profile = tab.sshProfileId
        ? sshProfiles.find((candidate) => candidate.id === tab.sshProfileId)
        : undefined;
      if (!profile) {
        console.error('SSH retry failed and no saved profile to reconnect from:', shellErr);
        return;
      }
      try {
        await window.janet.sshConnect({
          id: tab.sshSessionId,
          host: profile.host,
          port: profile.port,
          ...(profile.username ? { username: profile.username } : {}),
          auth: profile.auth,
          password: profile.auth === 'password' ? profile.password : undefined,
          privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
        });
        setReadySshSessionIds((prev) => new Set(prev).add(tab.sshSessionId!));
        await window.janet.sshCreateShell({ id: tab.sshSessionId, termId, ...dims });
      } catch (reconnectErr) {
        console.error('SSH retry failed:', reconnectErr);
      }
    }
  }, [sshProfiles]);

  const handleSSHProfilesChange = useCallback((profiles: SavedSSHProfile[]) => {
    setSshProfiles(profiles);
    try { window.janet.setSettings({ sshProfiles: profiles }).catch(() => {}); } catch {}
  }, []);

  const handleWorkspaceTabsChange = useCallback((presets: WorkspaceTabPreset[]) => {
    setWorkspaceTabs(presets);
    try { window.janet.setSettings({ workspaceTabs: presets }).catch(() => {}); } catch {}
  }, []);

  const saveWorkspaceTab = useCallback((tab: TabInfo) => {
    const workspaceId = tab.workspaceId ?? genId('workspace');
    const preset: WorkspaceTabPreset = {
      id: workspaceId,
      name: tab.title,
      type: tab.type,
      cwd: tab.type === 'local' ? tab.cwd : undefined,
      sshProfileId: tab.sshProfileId,
      root: serializePaneTree(tab.root, cwdByTerminal),
      terminalCount: getAllLeafIds(tab.root).length,
      splitDirection: tab.root.type === 'split' ? tab.root.direction : 'vertical',
    };
    setWorkspaceTabs((prev) => {
      const next = prev.some((existing) => existing.id === preset.id)
        ? prev.map((existing) => existing.id === preset.id ? preset : existing)
        : [...prev, preset];
      try { window.janet.setSettings({ workspaceTabs: next }).catch(() => {}); } catch {}
      return next;
    });
    if (!tab.workspaceId) {
      updateTab(tab.id, (existing) => ({ ...existing, workspaceId }));
    }
  }, [cwdByTerminal, updateTab]);

  const createTabFromPreset = useCallback((preset: WorkspaceTabPreset, sshSessionId?: string): TabInfo => ({
    id: genId('tab'),
    title: preset.name,
    type: preset.type,
    workspaceId: preset.id,
    sshSessionId,
    sshProfileId: preset.sshProfileId,
    sshShellReady: preset.type !== 'ssh',
    cwd: preset.type === 'local' ? preset.cwd : undefined,
    root: restorePaneTree(preset.root) ?? createPaneRoot(preset.type, preset.terminalCount, preset.splitDirection),
  }), []);

  const openWorkspaceTab = useCallback(async (preset: WorkspaceTabPreset) => {
    if (preset.type === 'local') {
      const tab = createTabFromPreset(preset);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
      return;
    }

    const profile = sshProfiles.find((candidate) => candidate.id === preset.sshProfileId);
    if (!profile) return;

    const sessionId = `ssh-${Date.now()}`;
    try {
      await window.janet.sshConnect({
        id: sessionId,
        host: profile.host,
        port: profile.port,
        ...(profile.username ? { username: profile.username } : {}),
        auth: profile.auth,
        password: profile.auth === 'password' ? profile.password : undefined,
        privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
      });
      const session = {
        id: sessionId,
        host: profile.host,
        port: profile.port,
        ...(profile.username ? { username: profile.username } : {}),
        sshProfileId: profile.id,
      };
      setSshSessions((prev) => [...prev, session]);
      setReadySshSessionIds((prev) => new Set(prev).add(sessionId));
      const tab = createTabFromPreset(preset, sessionId);
      tab.sshShellReady = true;
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    } catch (err) {
      console.error('Failed to open workspace SSH tab:', err);
    }
  }, [createTabFromPreset, sshProfiles]);

  useEffect(() => {
    if (workspaceTabsRestoredRef.current) return;
    // If a session restore is in flight or already happened, defer to it —
    // the session wins because it represents the user's actual open tabs.
    if (!sessionRestoredRef.current) return;
    if (workspaceTabs.length === 0) {
      workspaceTabsRestoredRef.current = true;
      return;
    }
    workspaceTabsRestoredRef.current = true;

    const localTabs = workspaceTabs
      .filter((preset) => preset.type === 'local')
      .map((preset) => createTabFromPreset(preset));

    if (localTabs.length > 0) {
      setTabs(localTabs);
      setActiveTabId(localTabs[0].id);
    }

    for (const preset of workspaceTabs.filter((candidate) => candidate.type === 'ssh')) {
      openWorkspaceTab(preset);
    }
  }, [createTabFromPreset, openWorkspaceTab, workspaceTabs]);

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
            root: createTabRoot('local'),
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

  useEffect(() => {
    let cancelled = false;

    if (!effectiveCwd || activeTab.type === 'ssh') {
      setGitStatus(null);
      return () => { cancelled = true; };
    }

    if (!window.janet.gitFindRepo || !window.janet.gitStatus) {
      setGitStatus(null);
      return () => { cancelled = true; };
    }

    window.janet.gitFindRepo({ startPath: effectiveCwd }).then(async (repoPath) => {
      if (cancelled || !repoPath) {
        if (!cancelled) setGitStatus(null);
        return;
      }
      const status = await window.janet.gitStatus({ repoPath });
      if (!cancelled) setGitStatus(status ? summarizeGitStatus(repoPath, status) : null);
    }).catch(() => {
      if (!cancelled) setGitStatus(null);
    });

    return () => { cancelled = true; };
  }, [activeTab.type, effectiveCwd]);

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
        onOpenPalette={() => setPaletteVisible(true)}
      />
      <div className={`app-body sidebar-${sidebarSide}`}>
        {sidebarOpen && (
          <Sidebar
            section={sidebarSection}
            onSectionChange={setSidebarSection}
            sshProfiles={sshProfiles}
            onSSHConnected={handleSSHConnected}
            onSSHProfilesChange={handleSSHProfilesChange}
            currentTheme={currentTheme}
            onThemeChange={persistTheme}
            fontSize={fontSize}
            onFontSizeChange={persistFontSize}
            sidebarSide={sidebarSide}
            onSidebarSideChange={persistSidebarSide}
            shortcutEditor={<ShortcutEditor />}
            cwd={effectiveCwd}
            cwdReady={Boolean(effectiveCwd)}
            isRemote={activeTab.type === 'ssh'}
            onOpenLocalTabAt={openLocalTabAt}
          />
        )}
        {tabsOpen ? (
          <VerticalTabBar
            tabs={tabs}
            activeTabId={activeTabId}
            sshProfiles={sshProfiles}
            workspaceTabs={workspaceTabs}
            onSelectTab={setActiveTabId}
            onCloseTab={closeTab}
            onNewTab={() => addTab('local')}
            onWorkspaceTabsChange={handleWorkspaceTabsChange}
            onWorkspaceTabLaunch={openWorkspaceTab}
            onSaveWorkspaceTab={saveWorkspaceTab}
            onRenameTab={renameTab}
            onCollapse={() => setTabsOpen(false)}
          />
        ) : (
          <button
            className="tabs-rail"
            onClick={() => setTabsOpen(true)}
            title="Show tabs"
            aria-label="Show tabs"
          >
            Tabs
          </button>
        )}
        <div className="terminal-area">
          <SplitPane
            node={activeTab.root}
            tabId={activeTab.id}
            tabType={activeTab.type}
            sshSessionId={activeTab.sshSessionId}
            sshShellReady={activeTab.type !== 'ssh' || activeTab.sshShellReady === true}
            onTerminalReady={handleTerminalReady}
            onTerminalRemoved={handleTerminalRemoved}
            onSplitPane={(leafId, dir) => handleSplitPane(activeTab.id, leafId, dir)}
            onClosePane={(leafId) => handleClosePane(activeTab.id, leafId)}
            onResizePane={(splitId, dividerIndex, leftFraction) => handleResizePane(activeTab.id, splitId, dividerIndex, leftFraction)}
            onMovePane={(draggedLeafId, targetLeafId, side) => handleMovePane(activeTab.id, draggedLeafId, targetLeafId, side)}
            draggedLeafId={draggedPaneId}
            dropTarget={paneDropTarget}
            onPaneDragStart={setDraggedPaneId}
            onPaneDragOver={setPaneDropTarget}
            onPaneDragEnd={() => { setDraggedPaneId(null); setPaneDropTarget(null); }}
            maximizedLeafId={maximizedLeafByTab[activeTab.id] ?? null}
            onToggleMaximizePane={(leafId) => handleToggleMaximizePane(activeTab.id, leafId)}
            themeName={currentTheme}
            fontSize={fontSize}
            onCwdChange={handleCwdChange}
            onTerminalFocus={handleTerminalFocus}
            initialCwd={activeTab.cwd || homeDir || undefined}
            hasSessionForLeaf={(leafId) => liveTerminalIdsRef.current.has(leafId)}
            onSshRetry={handleSshRetry}
          />
        </div>
      </div>
      <StatusBar
        sshSessions={sshSessions}
        activeTerminalsCount={activeTerminals.size}
        cwd={effectiveCwd}
        gitStatus={gitStatus}
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
