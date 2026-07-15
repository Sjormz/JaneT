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
  PaneNode, PaneDropSide, TerminalLeaf,
  createPaneRoot, splitPane, removePane, movePane, resizePane, getAllLeafIds, genId, mapLeaves, findLeaf,
} from './types';
import { ThemeName, applyCssTheme, getTheme } from './themes';
import { KeybindingsProvider, useKeybindings } from './KeybindingsContext';
import { KeybindingAction } from './keybindings';
import { serializePaneTree, restorePaneTree, normalizeSession, SavedSession } from './sessionRestore';
import { GitStatusSummary, summarizeGitStatus } from './gitStatus';
import { useGitRepository } from './useGitRepository';

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

interface TerminalOwner {
  termId: string;
  type: 'local' | 'ssh';
  sshSessionId?: string;
}

function collectTerminalOwners(tab: TabInfo): TerminalOwner[] {
  const owners: TerminalOwner[] = [];
  const collect = (node: PaneNode) => {
    if (node.type === 'leaf') {
      const type = node.terminalType ?? tab.type;
      owners.push({
        termId: node.id,
        type,
        sshSessionId: type === 'ssh' ? node.sshSessionId ?? tab.sshSessionId : undefined,
      });
      return;
    }
    node.children.forEach(collect);
  };
  collect(tab.root);
  return owners;
}

function ownsSshSession(tabs: TabInfo[], sessionId: string): boolean {
  return tabs.some((tab) => collectTerminalOwners(tab).some(
    (owner) => owner.type === 'ssh' && owner.sshSessionId === sessionId,
  ));
}

function preferredLeafId(tab: TabInfo, focusedTerminalId: string | null, maximizedLeafId?: string | null): string | null {
  const leaves = getAllLeafIds(tab.root);
  if (maximizedLeafId && leaves.includes(maximizedLeafId)) return maximizedLeafId;
  if (focusedTerminalId && leaves.includes(focusedTerminalId)) return focusedTerminalId;
  return leaves[0] ?? null;
}

function sshSessionInfo(sessionId: string, profile: SavedSSHProfile): SessionInfo {
  return {
    id: sessionId,
    host: profile.host,
    port: profile.port,
    ...(profile.username ? { username: profile.username } : {}),
    sshProfileId: profile.id,
  };
}

function localizeTerminalLeaf(leaf: TerminalLeaf): TerminalLeaf {
  const { sshProfileId: _profile, sshSessionId: _session, sshShellReady: _ready, ...local } = leaf;
  return { ...local, terminalType: 'local' };
}

function demoteSshTab(tab: TabInfo): TabInfo {
  return {
    ...tab,
    type: 'local',
    sshSessionId: undefined,
    sshProfileId: undefined,
    sshShellReady: undefined,
    root: mapLeaves(tab.root, localizeTerminalLeaf),
  };
}

function demoteSshLeaf(tab: TabInfo, leafId: string): TabInfo {
  return {
    ...tab,
    root: mapLeaves(tab.root, (leaf) => leaf.id === leafId ? localizeTerminalLeaf(leaf) : leaf),
  };
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
  const connectingSshSessionIdsRef = useRef<Set<string>>(new Set());
  const releasedSshSessionIdsRef = useRef<Set<string>>(new Set());

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
              let tree = restorePaneTree(saved.root);
              if (!tree) continue;
              if (saved.type !== 'ssh') {
                tree = mapLeaves(tree, (leaf) => leaf.terminalType === 'ssh' && leaf.sshProfileId ? {
                  ...leaf,
                  sshSessionId: `ssh-${Date.now()}-${leaf.id}`,
                  sshShellReady: false,
                } : leaf);
              }
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
            ? demoteSshTab(existing)
            : existing,
        ));
        continue;
      }
      const sessionId = tab.sshSessionId!;
      if (readySshSessionIds.has(sessionId) || connectingSshSessionIdsRef.current.has(sessionId)) {
        continue;
      }
      connectingSshSessionIdsRef.current.add(sessionId);
      window.janet.sshConnect({
        id: sessionId,
        host: profile.host,
        port: profile.port,
        ...(profile.username ? { username: profile.username } : {}),
        auth: profile.auth,
        password: profile.auth === 'password' ? profile.password : undefined,
        privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
      }).then(() => {
        if (
          releasedSshSessionIdsRef.current.has(sessionId) ||
          !ownsSshSession(tabsRef.current, sessionId)
        ) {
          window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
          return;
        }
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
            ? demoteSshTab(existing)
            : existing,
        ));
      }).finally(() => {
        connectingSshSessionIdsRef.current.delete(sessionId);
      });
    }
  }, [readySshSessionIds, sshProfiles]);

  // Mixed workspace tabs carry their SSH connection settings on individual leaves.
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    const leaves: Array<{ tabId: string; leafId: string; sshProfileId: string; sshSessionId: string }> = [];
    const collect = (tab: TabInfo, node: PaneNode) => {
      if (node.type === 'leaf') {
        if (node.terminalType === 'ssh' && node.sshProfileId && node.sshSessionId) leaves.push({ tabId: tab.id, leafId: node.id, sshProfileId: node.sshProfileId, sshSessionId: node.sshSessionId });
        return;
      }
      node.children.forEach((child) => collect(tab, child));
    };
    tabsRef.current.filter((tab) => tab.type !== 'ssh').forEach((tab) => collect(tab, tab.root));
    for (const leaf of leaves) {
      const profile = sshProfiles.find((candidate) => candidate.id === leaf.sshProfileId);
      if (!profile) {
        setTabs((current) => current.map((tab) => tab.id === leaf.tabId
          ? demoteSshLeaf(tab, leaf.leafId)
          : tab));
        continue;
      }
      if (
        readySshSessionIds.has(leaf.sshSessionId) ||
        connectingSshSessionIdsRef.current.has(leaf.sshSessionId)
      ) {
        continue;
      }
      connectingSshSessionIdsRef.current.add(leaf.sshSessionId);
      window.janet.sshConnect({
        id: leaf.sshSessionId, host: profile.host, port: profile.port,
        ...(profile.username ? { username: profile.username } : {}), auth: profile.auth,
        password: profile.auth === 'password' ? profile.password : undefined,
        privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
      }).then(() => {
        if (
          releasedSshSessionIdsRef.current.has(leaf.sshSessionId) ||
          !ownsSshSession(tabsRef.current, leaf.sshSessionId)
        ) {
          window.janet.sshDisconnect({ id: leaf.sshSessionId }).catch(() => {});
          return;
        }
        const session = sshSessionInfo(leaf.sshSessionId, profile);
        setSshSessions((current) => current.some((candidate) => candidate.id === session.id)
          ? current
          : [...current, session]);
        setReadySshSessionIds((current) => new Set(current).add(leaf.sshSessionId));
        setTabs((current) => current.map((tab) => tab.id === leaf.tabId
          ? { ...tab, root: mapLeaves(tab.root, (candidate) => candidate.id === leaf.leafId ? { ...candidate, sshShellReady: true } : candidate) }
          : tab));
      }).catch((error) => {
        console.error('Failed to reconnect saved workspace SSH terminal:', error);
        setTabs((current) => current.map((tab) => tab.id === leaf.tabId
          ? demoteSshLeaf(tab, leaf.leafId)
          : tab));
      })
        .finally(() => connectingSshSessionIdsRef.current.delete(leaf.sshSessionId));
    }
  }, [readySshSessionIds, sshProfiles]);

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
  }, [tabs, activeTabId, sidebarOpen, tabsOpen, sidebarSection, cwdByTerminal]);

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

  const teardownTerminalOwners = useCallback((owners: TerminalOwner[], remainingTabs: TabInfo[]) => {
    if (owners.length === 0) return;

    const retainedSshSessions = new Set(
      remainingTabs.flatMap(collectTerminalOwners)
        .filter((owner) => owner.type === 'ssh' && owner.sshSessionId)
        .map((owner) => owner.sshSessionId!),
    );
    const releasedSshSessions = new Set<string>();

    for (const owner of owners) {
      disposeCachedTerminal(owner.termId);
      liveTerminalIdsRef.current.delete(owner.termId);

      if (owner.type === 'local') {
        window.janet.terminalDestroy({ id: owner.termId }).catch(() => {});
        continue;
      }

      if (!owner.sshSessionId) continue;
      if (retainedSshSessions.has(owner.sshSessionId)) {
        window.janet.sshDestroyShell({ sessionId: owner.sshSessionId, termId: owner.termId }).catch(() => {});
      } else {
        releasedSshSessions.add(owner.sshSessionId);
      }
    }

    for (const sessionId of releasedSshSessions) {
      releasedSshSessionIdsRef.current.add(sessionId);
      window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
    }
    if (releasedSshSessions.size > 0) {
      setSshSessions((current) => current.filter((session) => !releasedSshSessions.has(session.id)));
      setReadySshSessionIds((current) => {
        const next = new Set(current);
        for (const sessionId of releasedSshSessions) next.delete(sessionId);
        return next;
      });
    }
    setActiveTerminals(new Set(liveTerminalIdsRef.current));
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
      const current = tabsRef.current;
      const idx = current.findIndex((tab) => tab.id === tabId);
      if (idx < 0) return;
      const tab = current[idx];
      let next = current.filter((candidate) => candidate.id !== tabId);

      if (next.length === 0) {
        const replacement: TabInfo = {
          id: genId('tab'),
          title: 'terminal',
          type: 'local',
          root: createTabRoot('local'),
        };
        next = [replacement];
        setActiveTabId(replacement.id);
      } else if (activeTabId === tabId) {
        setActiveTabId(next[Math.min(idx, next.length - 1)].id);
      }

      teardownTerminalOwners(collectTerminalOwners(tab), next);
      if (focusedTerminalId && getAllLeafIds(tab.root).includes(focusedTerminalId)) {
        setFocusedTerminalId(null);
      }
      setMaximizedLeafByTab((currentMaximized) => {
        if (!(tabId in currentMaximized)) return currentMaximized;
        const { [tabId]: _removed, ...rest } = currentMaximized;
        return rest;
      });
      // Make the pending effect cleanup observe the closed tree even before
      // React commits the state update.
      tabsRef.current = next;
      setTabs(next);
    },
    [activeTabId, focusedTerminalId, teardownTerminalOwners],
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
    setFocusedTerminalId(leafId);
    setMaximizedLeafByTab((prev) => ({
      ...prev,
      [tabId]: prev[tabId] === leafId ? null : leafId,
    }));
  }, []);

  const handleClosePane = useCallback(
    (tabId: string, leafId: string) => {
      const current = tabsRef.current;
      const tab = current.find((candidate) => candidate.id === tabId);
      if (!tab) return;
      const owners = collectTerminalOwners(tab).filter((owner) => owner.termId === leafId);
      if (owners.length === 0) return;

      const newRoot = removePane(tab.root, leafId);
      if (!newRoot) {
        closeTab(tabId);
        return;
      }
      const nextRoot = ensureSplitRoot(newRoot);
      const next = current.map((candidate) => candidate.id === tabId ? { ...candidate, root: nextRoot } : candidate);
      teardownTerminalOwners(owners, next);
      tabsRef.current = next;
      setTabs(next);

      const wasMaximized = maximizedLeafByTab[tabId] === leafId;
      if (wasMaximized) {
        setMaximizedLeafByTab((prev) => ({ ...prev, [tabId]: null }));
      }
      if (focusedTerminalId === leafId) {
        setFocusedTerminalId(getAllLeafIds(nextRoot)[0] ?? null);
      }
    },
    [closeTab, focusedTerminalId, maximizedLeafByTab, teardownTerminalOwners],
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
      releasedSshSessionIdsRef.current.delete(session.id);
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
      releasedSshSessionIdsRef.current.delete(tab.sshSessionId);
      connectingSshSessionIdsRef.current.add(tab.sshSessionId);
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
        if (
          releasedSshSessionIdsRef.current.has(tab.sshSessionId) ||
          !ownsSshSession(tabsRef.current, tab.sshSessionId)
        ) {
          window.janet.sshDisconnect({ id: tab.sshSessionId }).catch(() => {});
          return;
        }
        setReadySshSessionIds((prev) => new Set(prev).add(tab.sshSessionId!));
        await window.janet.sshCreateShell({ id: tab.sshSessionId, termId, ...dims });
      } catch (reconnectErr) {
        console.error('SSH retry failed:', reconnectErr);
      } finally {
        connectingSshSessionIdsRef.current.delete(tab.sshSessionId);
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

  const openWorkspaceTab = useCallback(async (preset: WorkspaceTabPreset) => {
    let root = restorePaneTree(preset.root) ?? createPaneRoot(preset.type, preset.terminalCount, preset.splitDirection);
    root = mapLeaves(root, (leaf) => leaf.terminalType !== 'ssh' ? leaf : {
      ...leaf,
      sshSessionId: `ssh-${Date.now()}-${leaf.id}`,
      sshShellReady: false,
    });
    const tab: TabInfo = {
      id: genId('tab'), title: preset.name, workspaceId: preset.id, type: 'local', root,
    };
    const nextTabs = [...tabsRef.current, tab];
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setActiveTabId(tab.id);

    const sshLeaves: Array<{ id: string; sshProfileId: string; sshSessionId: string }> = [];
    const collect = (node: PaneNode) => {
      if (node.type === 'leaf') {
        if (node.terminalType === 'ssh' && node.sshProfileId && node.sshSessionId) sshLeaves.push({ id: node.id, sshProfileId: node.sshProfileId, sshSessionId: node.sshSessionId });
        return;
      }
      node.children.forEach(collect);
    };
    collect(root);
    for (const leaf of sshLeaves) {
      const profile = sshProfiles.find((candidate) => candidate.id === leaf.sshProfileId);
      if (!profile) continue;
      releasedSshSessionIdsRef.current.delete(leaf.sshSessionId);
      connectingSshSessionIdsRef.current.add(leaf.sshSessionId);
      try {
        await window.janet.sshConnect({
          id: leaf.sshSessionId, host: profile.host, port: profile.port,
          ...(profile.username ? { username: profile.username } : {}), auth: profile.auth,
          password: profile.auth === 'password' ? profile.password : undefined,
          privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
        });
        if (
          releasedSshSessionIdsRef.current.has(leaf.sshSessionId) ||
          !ownsSshSession(tabsRef.current, leaf.sshSessionId)
        ) {
          window.janet.sshDisconnect({ id: leaf.sshSessionId }).catch(() => {});
          continue;
        }
        const session = sshSessionInfo(leaf.sshSessionId, profile);
        setSshSessions((current) => current.some((candidate) => candidate.id === session.id)
          ? current
          : [...current, session]);
        setReadySshSessionIds((current) => new Set(current).add(leaf.sshSessionId));
        updateTab(tab.id, (current) => ({ ...current, root: mapLeaves(current.root, (candidate) => candidate.id === leaf.id ? { ...candidate, sshShellReady: true } : candidate) }));
      } catch (error) {
        console.error('Failed to open workspace SSH terminal:', error);
      } finally {
        connectingSshSessionIdsRef.current.delete(leaf.sshSessionId);
      }
    }
  }, [sshProfiles, updateTab]);


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
  const sidebarTerminalId = useMemo(
    () => preferredLeafId(activeTab, focusedTerminalId, maximizedLeafByTab[activeTab.id]),
    [activeTab, focusedTerminalId, maximizedLeafByTab],
  );

  const sidebarLeaf = useMemo(
    () => sidebarTerminalId ? findLeaf(activeTab.root, sidebarTerminalId) : null,
    [activeTab, sidebarTerminalId],
  );
  const sidebarIsRemote = (sidebarLeaf?.terminalType ?? activeTab.type) === 'ssh';
  const sidebarSshSessionId = sidebarLeaf?.sshSessionId ?? (
    activeTab.type === 'ssh' ? activeTab.sshSessionId : undefined
  );
  const sidebarSshProfileId = sidebarLeaf?.sshProfileId ?? (
    activeTab.type === 'ssh' ? activeTab.sshProfileId : undefined
  );
  const sidebarRemoteHost = sidebarIsRemote
    ? sshSessions.find((session) => session.id === sidebarSshSessionId)?.host ??
      sshProfiles.find((profile) => profile.id === sidebarSshProfileId)?.host
    : undefined;

  // The effective cwd: prefer the focused terminal's last-known cwd, fall
  // back to the home dir. SSH terminals always show "~" since we can't
  // resolve a remote cwd into a local file tree.
  const effectiveCwd = useMemo(() => {
    if (sidebarIsRemote) return homeDir;
    if (sidebarTerminalId && cwdByTerminal[sidebarTerminalId]) {
      return cwdByTerminal[sidebarTerminalId];
    }
    return sidebarLeaf?.cwd || activeTab.cwd || homeDir;
  }, [activeTab.cwd, sidebarIsRemote, sidebarLeaf?.cwd, sidebarTerminalId, cwdByTerminal, homeDir]);
  const gitRepository = useGitRepository(effectiveCwd, !sidebarIsRemote);
  const gitStatus: GitStatusSummary | null = useMemo(
    () => gitRepository.repoPath && gitRepository.status
      ? summarizeGitStatus(gitRepository.repoPath, gitRepository.status)
      : null,
    [gitRepository.repoPath, gitRepository.status],
  );

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
      if (sidebarTerminalId) handleSplitPane(activeTab.id, sidebarTerminalId, 'vertical');
    });
    const unsub2 = on('split-down', () => {
      if (sidebarTerminalId) handleSplitPane(activeTab.id, sidebarTerminalId, 'horizontal');
    });
    const unsub3 = on('close-pane', () => {
      const leaves = getAllLeafIds(activeTab.root);
      if (sidebarTerminalId && leaves.length > 1) handleClosePane(activeTab.id, sidebarTerminalId);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [on, activeTab, sidebarTerminalId, handleSplitPane, handleClosePane]);

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
      if (sidebarTerminalId) {
        actions.push({
          id: 'split-right', label: 'Split Right', category: 'Pane',
          shortcut: bindings['split-right'], handler: () => handleSplitPane(activeTab.id, sidebarTerminalId, 'vertical'),
        });
        actions.push({
          id: 'split-down', label: 'Split Down', category: 'Pane',
          shortcut: bindings['split-down'], handler: () => handleSplitPane(activeTab.id, sidebarTerminalId, 'horizontal'),
        });
        if (leaves.length > 1) {
          actions.push({
            id: 'close-pane', label: 'Close Pane', category: 'Pane',
            shortcut: bindings['close-pane'], handler: () => handleClosePane(activeTab.id, sidebarTerminalId),
          });
        }
      }
    }

    return actions;
  }, [
    activeTab, activeTabId, sidebarTerminalId, addTab, closeTab, handleSplitPane, handleClosePane,
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
            isRemote={sidebarIsRemote}
            gitRepository={gitRepository}
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
        isRemote={sidebarIsRemote}
        remoteHost={sidebarRemoteHost}
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
