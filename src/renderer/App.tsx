import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import Titlebar from './components/Titlebar';
import VerticalTabBar from './components/VerticalTabBar';
import SplitPane from './components/SplitPane';
import { disposeCachedTerminal } from './components/TerminalPane';
import Sidebar, { WorkspaceToolSection } from './components/Sidebar';
import StatusBar from './components/StatusBar';
import CommandPalette, { CommandAction } from './components/CommandPalette';
import SnippetPicker from './components/SnippetPicker';
import ShortcutEditor from './components/ShortcutEditor';
import ThemeSwitcher from './components/ThemeSwitcher';
import UpdateBanner from './components/UpdateBanner';
import BrandMark from './components/BrandMark';
import Tooltip from './components/Tooltip';
import ConfirmationDialog from './components/ConfirmationDialog';
import WorkspaceContent from './components/WorkspaceContent';
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
import { requestTerminalSearch } from './terminalSearch';
import { requestTerminalPaste } from './terminalPaste';
import { formatTerminalPathForPaste } from './terminalPathDrag';
import type { FileExplorerSource } from './fileExplorerSource';
import { DEFAULT_TERMINAL_FONT_FAMILY, normalizeTerminalFontFamily } from '../shared/typography';
import { useEditorDocuments } from './useEditorDocuments';
import { emptyTabDocumentWorkspace, isEditorDocumentDirty, type EditorResource } from './editorDocuments';
import { snippetTextForPaste, type Snippet } from '../shared/snippets';

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

interface PendingDestructiveAction {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => void | boolean | Promise<void | boolean>;
  secondaryLabel?: string;
  runSecondary?: () => void | boolean | Promise<void | boolean>;
  onCancel?: () => void;
  destructive?: boolean;
  fallbackFocus?: () => HTMLElement | null;
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

function firstTerminalFocusTarget(): HTMLElement | null {
  const containers = Array.from(document.querySelectorAll<HTMLElement>('[data-terminal-focus-target]'));
  const container = containers.find((candidate) => candidate.offsetParent !== null) ?? containers[0];
  return container?.querySelector<HTMLElement>('textarea') ?? container ?? null;
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

function stripStartupAutomation(leaf: TerminalLeaf): TerminalLeaf {
  const {
    startupCommands: _startupCommands,
    startupShellDialect: _startupShellDialect,
    ...safeLeaf
  } = leaf;
  return safeLeaf;
}

function localizeTerminalLeaf(leaf: TerminalLeaf): TerminalLeaf {
  const {
    sshProfileId: _profile,
    sshSessionId: _session,
    sshShellReady: _ready,
    ...local
  } = stripStartupAutomation(leaf);
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

interface InitialAppState {
  tabs: TabInfo[];
  activeTabId: string;
  sidebarOpen: boolean;
  tabsOpen: boolean;
  sidebarSection: WorkspaceToolSection;
  settingsOpen: boolean;
  sshConnectionsOpen: boolean;
  sshProfiles: SavedSSHProfile[];
  workspaceTabs: WorkspaceTabPreset[];
  currentTheme: ThemeName;
  fontSize: number;
  fontFamily: string;
  sidebarSide: 'left' | 'right';
  snippets: Snippet[];
}

function createInitialAppState(settings: any): InitialAppState {
  const s = settings || {};
  const session = normalizeSession(s.session);
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
      // Allocate the runtime session id before any terminal component mounts.
      sshSessionId: saved.type === 'ssh' && saved.sshProfileId
        ? `ssh-${crypto.randomUUID()}`
        : undefined,
      sshShellReady: saved.type !== 'ssh',
      root: tree,
    };
    restored.push(tab);
    if (saved.id === session.activeTabId) restoredActiveId = tab.id;
  }

  const starterTab: TabInfo = {
    id: genId('tab'),
    title: 'Terminal',
    type: 'local',
    root: createTabRoot('local'),
  };
  const tabs = restored.length > 0 ? restored : [starterTab];
  const theme = getTheme(s.theme || 'tokyo-night').name;
  const restoreLegacySettings = session.sidebarOpen && session.sidebarSection === 'settings';
  const restoreLegacySsh = session.sidebarOpen && session.sidebarSection === 'ssh';
  const restoreMovedLegacySurface = restoreLegacySettings || restoreLegacySsh;

  return {
    tabs,
    activeTabId: restoredActiveId ?? tabs[0].id,
    sidebarOpen: restoreMovedLegacySurface ? false : session.sidebarOpen,
    tabsOpen: restoreLegacySsh ? true : session.tabsOpen,
    sidebarSection: session.sidebarSection === 'git' ? 'git' : 'files',
    settingsOpen: restoreLegacySettings,
    sshConnectionsOpen: restoreLegacySsh,
    sshProfiles: Array.isArray(s.sshProfiles) ? s.sshProfiles : [],
    workspaceTabs: Array.isArray(s.workspaceTabs) ? s.workspaceTabs : [],
    currentTheme: theme,
    fontSize: typeof s.fontSize === 'number' ? s.fontSize : 14,
    fontFamily: normalizeTerminalFontFamily(s.fontFamily ?? DEFAULT_TERMINAL_FONT_FAMILY),
    sidebarSide: s.sidebarSide === 'left' ? 'left' : 'right',
    snippets: Array.isArray(s.snippets) ? s.snippets : [],
  };
}

function AppInner({ initialSettings }: { initialSettings: any }) {
  // Settings have already loaded before AppInner mounts, so derive the first
  // render synchronously. This prevents a disposable starter terminal from
  // being created before a saved workspace replaces it.
  const [initialState] = useState(() => createInitialAppState(initialSettings));
  const [tabs, setTabs] = useState<TabInfo[]>(initialState.tabs);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [activeTabId, setActiveTabId] = useState(initialState.activeTabId);
  const [sidebarOpen, setSidebarOpen] = useState(initialState.sidebarOpen);
  const [tabsOpen, setTabsOpen] = useState(initialState.tabsOpen);
  const responsiveTabsCollapsedRef = useRef(false);
  const [sidebarSection, setSidebarSection] = useState<WorkspaceToolSection>(initialState.sidebarSection);
  const [sshSessions, setSshSessions] = useState<SessionInfo[]>([]);
  const [readySshSessionIds, setReadySshSessionIds] = useState<Set<string>>(new Set());
  const [disconnectedSshSessionIds, setDisconnectedSshSessionIds] = useState<Set<string>>(new Set());
  const [sshConnectionEpochById, setSshConnectionEpochById] = useState<Record<string, number>>({});
  const [sshProfiles, setSshProfiles] = useState<SavedSSHProfile[]>(initialState.sshProfiles);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabPreset[]>(initialState.workspaceTabs);
  const [maximizedLeafByTab, setMaximizedLeafByTab] = useState<Record<string, string | null>>({});
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [paneDropTarget, setPaneDropTarget] = useState<{ leafId: string; side: PaneDropSide } | null>(null);
  const liveTerminalIdsRef = useRef<Set<string>>(new Set());
  const connectingSshSessionIdsRef = useRef<Set<string>>(new Set());
  const releasedSshSessionIdsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const narrowWindow = window.matchMedia('(max-width: 1000px)');
    const syncResponsiveTabs = () => {
      if (narrowWindow.matches) {
        setTabsOpen((current) => {
          if (!current) return current;
          responsiveTabsCollapsedRef.current = true;
          return false;
        });
      } else if (responsiveTabsCollapsedRef.current) {
        responsiveTabsCollapsedRef.current = false;
        setTabsOpen(true);
      }
    };
    syncResponsiveTabs();
    narrowWindow.addEventListener('change', syncResponsiveTabs);
    return () => narrowWindow.removeEventListener('change', syncResponsiveTabs);
  }, []);

  const markSshSessionReady = useCallback((sessionId: string) => {
    setReadySshSessionIds((current) => new Set(current).add(sessionId));
    setDisconnectedSshSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
  }, []);

  const isSshSessionDisconnected = useCallback((sessionId?: string) => (
    Boolean(sessionId && disconnectedSshSessionIds.has(sessionId))
  ), [disconnectedSshSessionIds]);

  useEffect(() => {
    if (!window.janet.onSSHConnectionClosed) return undefined;
    return window.janet.onSSHConnectionClosed(({ id }) => {
      setSshSessions((current) => current.filter((session) => session.id !== id));
      setReadySshSessionIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setDisconnectedSshSessionIds((current) => new Set(current).add(id));
      setSshConnectionEpochById((current) => ({
        ...current,
        [id]: (current[id] ?? 0) + 1,
      }));
    });
  }, []);

  const restoredSshTabsStartedRef = useRef(false);
  const restoredSshLeavesStartedRef = useRef(false);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [snippetsVisible, setSnippetsVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialState.settingsOpen);
  const [sshConnectionsOpen, setSshConnectionsOpen] = useState(initialState.sshConnectionsOpen);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
  const [pendingDestructiveBusy, setPendingDestructiveBusy] = useState(false);
  const editorDocuments = useEditorDocuments();

  const setWorkspaceToolsExpanded = useCallback((expanded: boolean) => {
    if (!expanded && document.activeElement instanceof HTMLElement
      && document.activeElement.closest('.workspace-tools-panel')) {
      document.querySelector<HTMLElement>('.workspace-tool-button[aria-selected="true"]')?.focus();
    }
    setSidebarOpen(expanded);
  }, []);

  const toggleWorkspaceTools = useCallback(() => {
    setWorkspaceToolsExpanded(!sidebarOpen);
  }, [setWorkspaceToolsExpanded, sidebarOpen]);

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
  const [currentTheme, setCurrentTheme] = useState<ThemeName>(initialState.currentTheme);
  const [fontSize, setFontSize] = useState(initialState.fontSize);
  const [fontFamily] = useState(initialState.fontFamily);
  const [sidebarSide, setSidebarSide] = useState<'left' | 'right'>(initialState.sidebarSide);
  const [snippets, setSnippets] = useState<Snippet[]>(initialState.snippets);
  const settingsLoadedRef = useRef(true);

  const { bindings, matches, on } = useKeybindings();

  // Reconnect SSH tabs that were restored from the saved session.
  // The tree is rebuilt with fresh leaf ids during restore, and the
  // session id is pre-allocated so the TerminalPane mounts with a
  // stable `sshSessionId` prop. The transport is still dead though
  // (it's a fresh app start) — so this effect kicks off `ssh:connect`
  // on the pre-allocated id, registers the session for the sidebar
  // status, and surfaces any connect error to the user.
  useEffect(() => {
    if (restoredSshTabsStartedRef.current) return;
    restoredSshTabsStartedRef.current = true;
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
      if (connectingSshSessionIdsRef.current.has(sessionId)) {
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
        markSshSessionReady(sessionId);
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
  }, [markSshSessionReady, sshProfiles]);

  // Mixed workspace tabs carry their SSH connection settings on individual leaves.
  useEffect(() => {
    if (restoredSshLeavesStartedRef.current) return;
    restoredSshLeavesStartedRef.current = true;
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
      if (connectingSshSessionIdsRef.current.has(leaf.sshSessionId)) {
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
        markSshSessionReady(leaf.sshSessionId);
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
  }, [markSshSessionReady, sshProfiles]);

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
        root: serializePaneTree(tab.root, cwdByTerminal, { includeStartupCommands: true }),
      }));
      const session: SavedSession = {
        tabs: savedTabs,
        activeTabId,
        sidebarOpen,
        tabsOpen: responsiveTabsCollapsedRef.current ? true : tabsOpen,
        sidebarSection,
      };
      try { window.janet.setSettings({ session }).catch(() => {}); } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId, sidebarOpen, tabsOpen, sidebarSection, cwdByTerminal]);

  // Apply the loaded theme before paint and keep it synchronized thereafter.
  useLayoutEffect(() => {
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

  const persistSnippets = useCallback((next: Snippet[]) => {
    setSnippets(next);
    try { window.janet.setSettings({ snippets: next }).catch(() => {}); } catch {}
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

  const selectTerminalTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    editorDocuments.selectSurface(tabId, 'terminal');
    requestAnimationFrame(() => firstTerminalFocusTarget()?.focus());
  }, [editorDocuments.selectSurface]);

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
      setDisconnectedSshSessionIds((current) => {
        const next = new Set(current);
        for (const sessionId of releasedSshSessions) next.delete(sessionId);
        return next;
      });
      setSshConnectionEpochById((current) => {
        const next = { ...current };
        for (const sessionId of releasedSshSessions) delete next[sessionId];
        return next;
      });
    }
  }, []);

  // Called when a TerminalPane unmounts
  const handleTerminalRemoved = useCallback(
    (termId: string) => {
      window.setTimeout(() => {
        const stillRendered = tabsRef.current.some((tab) => getAllLeafIds(tab.root).includes(termId));
        if (stillRendered) return;

        liveTerminalIdsRef.current.delete(termId);
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
        title: title || (type === 'local' ? `Terminal ${tabs.length + 1}` : `SSH ${tabs.length + 1}`),
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
          title: 'Terminal',
          type: 'local',
          root: createTabRoot('local'),
        };
        next = [replacement];
        setActiveTabId(replacement.id);
      } else if (activeTabId === tabId) {
        setActiveTabId(next[Math.min(idx, next.length - 1)].id);
      }

      editorDocuments.closeDocumentsForTab(tabId);
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
    [activeTabId, editorDocuments.closeDocumentsForTab, focusedTerminalId, teardownTerminalOwners],
  );

  const saveEditorDocument = useCallback(async (
    key: string,
    afterSave?: () => void,
  ): Promise<boolean> => {
    const documentTitle = () => (
      editorDocuments.documents.find((candidate) => candidate.key === key)?.title ?? 'file'
    );
    const attempt = async (overwrite = false): Promise<boolean> => {
      const outcome = await editorDocuments.saveDocument(key, overwrite);
      if (outcome === 'saved') {
        afterSave?.();
        return true;
      }
      if (outcome === 'CONFLICT') {
        setPendingDestructiveAction({
          title: `Overwrite newer changes to ${documentTitle()}?`,
          description: 'This file changed outside JaneT after it was opened. Overwriting will replace those newer on-disk changes with the editor contents.',
          confirmLabel: 'Overwrite file',
          run: () => attempt(true),
        });
        return false;
      }

      setPendingDestructiveAction({
        title: `Couldn’t save ${documentTitle()}`,
        description: 'JaneT left the file open and preserved the editor contents. Review the editor error, then try again or keep editing.',
        confirmLabel: 'Keep editing',
        run: () => true,
        secondaryLabel: 'Try again',
        runSecondary: () => attempt(overwrite),
        destructive: false,
      });
      return false;
    };

    return attempt();
  }, [editorDocuments.documents, editorDocuments.saveDocument]);

  const saveEditorDocumentSequence = useCallback((
    keys: string[],
    onComplete: () => void | boolean | Promise<void | boolean>,
    onCancel?: () => void,
  ): Promise<boolean> => {
    const showSaveFailure = (
      title: string,
      retry: () => Promise<boolean>,
    ): false => {
      setPendingDestructiveAction({
        title: `Couldn’t save ${title}`,
        description: 'JaneT left the file and its terminal workspace open. Review the editor error, then try the save again or keep editing.',
        confirmLabel: 'Keep editing',
        run: () => {
          onCancel?.();
        },
        secondaryLabel: 'Try again',
        runSecondary: retry,
        onCancel,
        destructive: false,
      });
      return false;
    };

    const promptConflict = (key: string, index: number, title: string): false => {
      setPendingDestructiveAction({
        title: `Overwrite newer changes to ${title}?`,
        description: 'This file changed outside JaneT. Overwrite it and continue saving the remaining files?',
        confirmLabel: 'Overwrite and continue',
        run: () => overwriteAndContinue(key, index, title),
        onCancel,
      });
      return false;
    };

    async function overwriteAndContinue(key: string, index: number, title: string): Promise<boolean> {
      const outcome = await editorDocuments.saveDocument(key, true);
      if (outcome === 'saved') return saveFrom(index + 1);
      if (outcome === 'CONFLICT') return promptConflict(key, index, title);
      return showSaveFailure(title, () => overwriteAndContinue(key, index, title));
    }

    const saveFrom = async (startIndex: number): Promise<boolean> => {
      for (let index = startIndex; index < keys.length; index += 1) {
        const key = keys[index];
        const outcome = await editorDocuments.saveDocument(key);
        if (outcome === 'saved') continue;

        const document = editorDocuments.documents.find((candidate) => candidate.key === key);
        const title = document?.title ?? 'file';
        if (outcome === 'CONFLICT') {
          return promptConflict(key, index, title);
        }
        return showSaveFailure(title, () => saveFrom(index));
      }

      const result = await onComplete();
      return result !== false;
    };

    return saveFrom(0);
  }, [editorDocuments.documents, editorDocuments.saveDocument]);

  const requestCloseEditorDocument = useCallback((
    key: string,
    fallbackFocus: () => HTMLElement | null = firstTerminalFocusTarget,
  ) => {
    const document = editorDocuments.documents.find((candidate) => candidate.key === key);
    if (!document) return;
    if (!isEditorDocumentDirty(document)) {
      editorDocuments.closeDocument(key);
      requestAnimationFrame(() => fallbackFocus()?.focus());
      return;
    }
    setPendingDestructiveAction({
      title: `Save changes to ${document.title}?`,
      description: 'This file has unsaved changes. Save them before closing, or explicitly discard the editor contents.',
      confirmLabel: "Don't Save",
      run: () => editorDocuments.closeDocument(key),
      secondaryLabel: 'Save',
      runSecondary: () => saveEditorDocument(key, () => editorDocuments.closeDocument(key)),
      fallbackFocus,
    });
  }, [editorDocuments.closeDocument, editorDocuments.documents, saveEditorDocument]);

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

  const requestCloseTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    const paneCount = getAllLeafIds(tab.root).length;
    const dirtyDocuments = (editorDocuments.documentsByTab[tabId] ?? []).filter(isEditorDocumentDirty);
    if (dirtyDocuments.length > 0) {
      const dirtyKeys = dirtyDocuments.map((document) => document.key);
      setPendingDestructiveAction({
        title: `Save ${dirtyDocuments.length} changed ${dirtyDocuments.length === 1 ? 'file' : 'files'} before closing ${tab.title}?`,
        description: `Closing this terminal tab will also close its editor documents and end ${paneCount} terminal ${paneCount === 1 ? 'session' : 'sessions'}. Save the changed files, or explicitly discard them and close.`,
        confirmLabel: 'Discard and close',
        run: () => closeTab(tabId),
        secondaryLabel: 'Save all and close',
        runSecondary: () => saveEditorDocumentSequence(dirtyKeys, () => closeTab(tabId)),
        fallbackFocus: firstTerminalFocusTarget,
      });
      return;
    }
    setPendingDestructiveAction({
      title: `Close ${tab.title}?`,
      description: `Close this terminal tab and its ${paneCount} pane${paneCount === 1 ? '' : 's'}? Its terminal sessions will end; detached jobs may continue outside JaneT.`,
      confirmLabel: 'Close tab',
      run: () => closeTab(tabId),
      fallbackFocus: firstTerminalFocusTarget,
    });
  }, [closeTab, editorDocuments.documentsByTab, saveEditorDocumentSequence]);

  useEffect(() => {
    if (!window.janet.onPrepareForClose || !window.janet.resolvePrepareForClose) return undefined;
    return window.janet.onPrepareForClose(async (request) => {
      if (pendingDestructiveAction || pendingDestructiveBusy) {
        await window.janet.resolvePrepareForClose({
          requestId: request.requestId,
          resolution: 'cancel',
        });
        return;
      }

      const dirtyDocuments = editorDocuments.dirtyDocuments;
      if (dirtyDocuments.length === 0) {
        await window.janet.resolvePrepareForClose({
          requestId: request.requestId,
          resolution: 'saved',
        });
        return;
      }

      const reason = request.reason === 'update-install'
        ? 'installing the update'
        : request.reason === 'tray-stop'
          ? 'stopping JaneT'
          : 'closing JaneT';
      const cancelClose = () => {
        void window.janet.resolvePrepareForClose({
          requestId: request.requestId,
          resolution: 'cancel',
        });
      };
      setPendingDestructiveAction({
        title: `Save ${dirtyDocuments.length} changed ${dirtyDocuments.length === 1 ? 'file' : 'files'} before ${reason}?`,
        description: 'JaneT can save every changed file before continuing, or you can explicitly discard the editor changes. Cancel keeps the application, terminals, and files open.',
        confirmLabel: 'Discard changes and close',
        run: async () => window.janet.resolvePrepareForClose({
          requestId: request.requestId,
          resolution: 'discarded',
        }),
        secondaryLabel: 'Save all and close',
        runSecondary: () => saveEditorDocumentSequence(
          dirtyDocuments.map((document) => document.key),
          () => window.janet.resolvePrepareForClose({
            requestId: request.requestId,
            resolution: 'saved',
          }),
          cancelClose,
        ),
        onCancel: cancelClose,
        fallbackFocus: firstTerminalFocusTarget,
      });
    });
  }, [
    editorDocuments.dirtyDocuments,
    pendingDestructiveAction,
    pendingDestructiveBusy,
    saveEditorDocumentSequence,
  ]);

  const requestClosePane = useCallback((tabId: string, leafId: string) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    if (getAllLeafIds(tab.root).length === 1) {
      requestCloseTab(tabId);
      return;
    }
    const leaf = findLeaf(tab.root, leafId);
    const paneTitle = leaf?.title?.trim();
    setPendingDestructiveAction({
      title: paneTitle ? `Close ${paneTitle}?` : 'Close terminal pane?',
      description: 'Close this terminal pane? Its terminal session will end; detached jobs may continue outside JaneT.',
      confirmLabel: 'Close pane',
      run: () => handleClosePane(tabId, leafId),
      fallbackFocus: firstTerminalFocusTarget,
    });
  }, [handleClosePane, requestCloseTab]);

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
      markSshSessionReady(session.id);
      addTab('ssh', session.id, true, session.sshProfileId);
      setSshConnectionsOpen(false);
    },
    [addTab, markSshSessionReady],
  );

  // Re-open the SSH shell for a single term. Triggered by the
  // "Reconnect" button on the SSH notice. If the underlying SSH
  // session is gone (server closed the connection), reconnect the
  // session first using the tab's saved profile.
  const handleSshRetry = useCallback(async (
    termId: string,
    dimensions: { cols: number; rows: number },
  ) => {
    const tab = tabsRef.current.find((candidate) => getAllLeafIds(candidate.root).includes(termId));
    const leaf = tab ? findLeaf(tab.root, termId) : null;
    const leafType = leaf?.terminalType ?? tab?.type;
    const sessionId = leaf?.sshSessionId ?? tab?.sshSessionId;
    const profileId = leaf?.sshProfileId ?? tab?.sshProfileId;
    if (!tab || leafType !== 'ssh' || !sessionId) {
      throw new Error('SSH session is no longer available');
    }

    const dims = {
      cols: Math.max(dimensions?.cols || 80, 120),
      rows: Math.max(dimensions?.rows || 24, 40),
    };

    try {
      await window.janet.sshCreateShell({
        id: sessionId,
        termId,
        ...dims,
        ...(leaf?.startupCommands?.length ? { startupCommands: leaf.startupCommands } : {}),
        ...(leaf?.startupShellDialect ? { startupShellDialect: leaf.startupShellDialect } : {}),
      });
    } catch (shellErr) {
      // Shell open failed — the session itself may be dead. Try
      // re-establishing the SSH connection from the saved profile,
      // then re-open the shell. If the profile is missing the user
      // will see the original error and can dismiss the tab.
      const profile = profileId
        ? sshProfiles.find((candidate) => candidate.id === profileId)
        : undefined;
      if (!profile) {
        console.error('SSH retry failed and no saved profile to reconnect from:', shellErr);
        throw shellErr;
      }
      releasedSshSessionIdsRef.current.delete(sessionId);
      connectingSshSessionIdsRef.current.add(sessionId);
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
        if (
          releasedSshSessionIdsRef.current.has(sessionId) ||
          !ownsSshSession(tabsRef.current, sessionId)
        ) {
          window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
          return;
        }
        const session = sshSessionInfo(sessionId, profile);
        setSshSessions((current) => current.some((candidate) => candidate.id === sessionId)
          ? current
          : [...current, session]);
        markSshSessionReady(sessionId);
        await window.janet.sshCreateShell({
          id: sessionId,
          termId,
          ...dims,
          ...(leaf?.startupCommands?.length ? { startupCommands: leaf.startupCommands } : {}),
          ...(leaf?.startupShellDialect ? { startupShellDialect: leaf.startupShellDialect } : {}),
        });
      } catch (reconnectErr) {
        console.error('SSH retry failed:', reconnectErr);
        throw reconnectErr;
      } finally {
        connectingSshSessionIdsRef.current.delete(sessionId);
      }
    }
  }, [markSshSessionReady, sshProfiles]);

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
      root: serializePaneTree(tab.root, cwdByTerminal, { includeStartupCommands: true }),
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

  const requestSaveWorkspaceTab = useCallback((tab: TabInfo) => {
    const existingPreset = tab.workspaceId
      ? workspaceTabs.find((preset) => preset.id === tab.workspaceId)
      : undefined;
    if (!existingPreset) {
      saveWorkspaceTab(tab);
      return;
    }
    setPendingDestructiveAction({
      title: `Update preset “${existingPreset.name}”?`,
      description: 'Replace the saved preset with this tab’s current layout, directories, and startup commands?',
      confirmLabel: 'Update preset',
      run: () => saveWorkspaceTab(tab),
      fallbackFocus: firstTerminalFocusTarget,
    });
  }, [saveWorkspaceTab, workspaceTabs]);

  const openWorkspaceTab = useCallback(async (preset: WorkspaceTabPreset) => {
    const restoredRoot = restorePaneTree(preset.root);
    let root = restoredRoot ?? createPaneRoot(preset.type, preset.terminalCount, preset.splitDirection);
    if (!restoredRoot) {
      // Legacy presets stored one terminal configuration at the top level.
      // Carry it into each synthesized leaf before the preset becomes a mixed
      // workspace tab, otherwise rootless SSH presets cannot connect.
      root = mapLeaves(root, (leaf) => preset.type === 'ssh'
        ? { ...leaf, terminalType: 'ssh', sshProfileId: preset.sshProfileId }
        : { ...leaf, terminalType: 'local', cwd: preset.cwd });
    }
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

    const sshLeaves: Array<{ id: string; sshProfileId?: string; sshSessionId: string }> = [];
    const collect = (node: PaneNode) => {
      if (node.type === 'leaf') {
        if (node.terminalType === 'ssh' && node.sshSessionId) {
          sshLeaves.push({ id: node.id, sshProfileId: node.sshProfileId, sshSessionId: node.sshSessionId });
        }
        return;
      }
      node.children.forEach(collect);
    };
    collect(root);
    for (const leaf of sshLeaves) {
      const profile = sshProfiles.find((candidate) => candidate.id === leaf.sshProfileId);
      if (!profile) {
        updateTab(tab.id, (current) => demoteSshLeaf(current, leaf.id));
        continue;
      }
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
        markSshSessionReady(leaf.sshSessionId);
        updateTab(tab.id, (current) => ({ ...current, root: mapLeaves(current.root, (candidate) => candidate.id === leaf.id ? { ...candidate, sshShellReady: true } : candidate) }));
      } catch (error) {
        console.error('Failed to open workspace SSH terminal:', error);
        updateTab(tab.id, (current) => demoteSshLeaf(current, leaf.id));
      } finally {
        connectingSshSessionIdsRef.current.delete(leaf.sshSessionId);
      }
    }
  }, [markSshSessionReady, sshProfiles, updateTab]);


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
  const copyTerminalPath = useCallback(async (path: string) => {
    const pasteToken = formatTerminalPathForPaste(path, sidebarLeaf?.startupShellDialect);
    if (!pasteToken) throw new Error('Path cannot be pasted safely');
    const copied = await window.janet.copyText(pasteToken);
    if (!copied) throw new Error('Path could not be copied');
  }, [sidebarLeaf?.startupShellDialect]);
  const sidebarIsRemote = (sidebarLeaf?.terminalType ?? activeTab.type) === 'ssh';
  const sidebarSshSessionId = sidebarLeaf?.sshSessionId ?? (
    activeTab.type === 'ssh' ? activeTab.sshSessionId : undefined
  );
  const sidebarSshProfileId = sidebarLeaf?.sshProfileId ?? (
    activeTab.type === 'ssh' ? activeTab.sshProfileId : undefined
  );
  const sidebarSshSession = sidebarIsRemote
    ? sshSessions.find((session) => session.id === sidebarSshSessionId)
    : undefined;
  const sidebarSshProfile = sidebarIsRemote
    ? sshProfiles.find((profile) => profile.id === sidebarSshProfileId)
    : undefined;
  const sidebarRemoteHost = sidebarIsRemote
    ? sidebarSshSession?.host ?? sidebarSshProfile?.host
    : undefined;
  const sidebarRemotePort = sidebarSshSession?.port ?? sidebarSshProfile?.port;
  const sidebarRemoteUsername = sidebarSshSession?.username ?? sidebarSshProfile?.username;
  const sidebarRemoteLabel = sidebarRemoteHost
    ? `${sidebarRemoteUsername ? `${sidebarRemoteUsername}@` : ''}${sidebarRemoteHost}${sidebarRemotePort ? `:${sidebarRemotePort}` : ''}`
    : 'SSH session';

  // The effective cwd remains a local-only input for Git and status surfaces.
  // Remote Explorer navigation is derived separately from SFTP below.
  const effectiveCwd = useMemo(() => {
    if (sidebarIsRemote) return homeDir;
    if (sidebarTerminalId && cwdByTerminal[sidebarTerminalId]) {
      return cwdByTerminal[sidebarTerminalId];
    }
    return sidebarLeaf?.cwd || activeTab.cwd || homeDir;
  }, [activeTab.cwd, sidebarIsRemote, sidebarLeaf?.cwd, sidebarTerminalId, cwdByTerminal, homeDir]);
  const explorerSource = useMemo<FileExplorerSource>(() => {
    if (sidebarIsRemote) {
      const sessionId = sidebarSshSessionId ?? '';
      const connectionState = disconnectedSshSessionIds.has(sessionId)
        ? 'disconnected'
        : sessionId && readySshSessionIds.has(sessionId)
          ? 'ready'
          : 'connecting';
      return {
        kind: 'ssh',
        key: `ssh:${sidebarTerminalId ?? activeTab.id}:${sessionId || 'pending'}:${sshConnectionEpochById[sessionId] ?? 0}`,
        sessionId,
        label: sidebarRemoteLabel,
        connectionState,
        ready: connectionState === 'ready',
      };
    }
    return {
      kind: 'local',
      key: `local:${sidebarTerminalId ?? activeTab.id}`,
      cwd: effectiveCwd,
      ready: Boolean(effectiveCwd),
    };
  }, [
    activeTab.id, disconnectedSshSessionIds, effectiveCwd, readySshSessionIds, sidebarIsRemote,
    sidebarRemoteLabel, sidebarSshSessionId, sidebarTerminalId,
    sshConnectionEpochById,
  ]);
  const gitRepository = useGitRepository(effectiveCwd, !sidebarIsRemote);
  const gitStatus: GitStatusSummary | null = useMemo(
    () => gitRepository.repoPath && gitRepository.status
      ? summarizeGitStatus(gitRepository.repoPath, gitRepository.status)
      : null,
    [gitRepository.repoPath, gitRepository.status],
  );
  const openEditorFile = useCallback((resource: EditorResource) => {
    void editorDocuments.openDocument(activeTab.id, resource);
  }, [activeTab.id, editorDocuments.openDocument]);
  const activeDocuments = editorDocuments.documentsByTab[activeTab.id] ?? [];
  const activeDocumentWorkspace = editorDocuments.workspaces[activeTab.id] ?? emptyTabDocumentWorkspace();

  // === Keyboard shortcuts via keybindings context ===
  // Register global action handlers
  useEffect(() => {
    const unsub1 = on('palette-toggle', () => {
      setPaletteVisible((v) => !v);
    });
    const unsub2 = on('new-terminal', () => addTab('local'));
    const unsub3 = on('close-tab', () => requestCloseTab(activeTabId));
    const unsub4 = on('toggle-sidebar', toggleWorkspaceTools);
    const unsub5 = on('font-increase', () => persistFontSize(Math.min(24, fontSize + 1)));
    const unsub6 = on('font-decrease', () => persistFontSize(Math.max(10, fontSize - 1)));
    const unsub7 = on('snippets-toggle', () => setSnippetsVisible(true));
    return () => {
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7();
    };
  }, [on, addTab, requestCloseTab, activeTabId, toggleWorkspaceTools, persistFontSize, fontSize]);

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
      if (sidebarTerminalId && leaves.length > 1) requestClosePane(activeTab.id, sidebarTerminalId);
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [on, activeTab, sidebarTerminalId, handleSplitPane, requestClosePane]);

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
        id: 'new-terminal', label: 'New terminal tab', category: 'Tabs',
        shortcut: bindings['new-terminal'], handler: () => addTab('local'),
      },
      {
        id: 'close-tab', label: 'Close current tab', category: 'Tabs',
        shortcut: bindings['close-tab'], handler: () => requestCloseTab(activeTabId),
      },
      {
        id: 'toggle-sidebar', label: 'Show or hide workspace tools', category: 'View',
        shortcut: bindings['toggle-sidebar'], handler: toggleWorkspaceTools,
      },
      {
        id: 'sidebar-files', label: 'Open Explorer', category: 'View',
        handler: () => { setWorkspaceToolsExpanded(true); setSidebarSection('files'); },
      },
      {
        id: 'sidebar-ssh', label: 'Open SSH connections', category: 'View',
        handler: () => {
          responsiveTabsCollapsedRef.current = false;
          setTabsOpen(true);
          setSshConnectionsOpen(true);
        },
      },
      {
        id: 'sidebar-git', label: 'Open Source Control', category: 'View',
        handler: () => { setWorkspaceToolsExpanded(true); setSidebarSection('git'); },
      },
      {
        id: 'sidebar-settings', label: 'Open Settings', category: 'View',
        handler: () => setSettingsOpen(true),
      },
      {
        id: 'font-increase', label: 'Increase terminal text size', category: 'Settings',
        shortcut: bindings['font-increase'], handler: () => persistFontSize(Math.min(24, fontSize + 1)),
      },
      {
        id: 'font-decrease', label: 'Decrease terminal text size', category: 'Settings',
        shortcut: bindings['font-decrease'], handler: () => persistFontSize(Math.max(10, fontSize - 1)),
      },
      {
        id: 'search-toggle', label: 'Search terminal output', category: 'Terminal',
        shortcut: bindings['search-toggle'],
        handler: () => {
          if (sidebarTerminalId) requestTerminalSearch(sidebarTerminalId);
        },
      },
      {
        id: 'palette-toggle', label: 'Open command palette', category: 'General',
        shortcut: bindings['palette-toggle'], handler: () => setPaletteVisible((v) => !v),
      },
      {
        id: 'snippets-toggle', label: 'Open snippets', category: 'Terminal',
        shortcut: bindings['snippets-toggle'], handler: () => setSnippetsVisible(true),
      },
      {
        id: 'check-updates', label: 'Check for updates', category: 'General',
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
          id: 'split-right', label: 'Split pane right', category: 'Pane',
          shortcut: bindings['split-right'], handler: () => handleSplitPane(activeTab.id, sidebarTerminalId, 'vertical'),
        });
        actions.push({
          id: 'split-down', label: 'Split pane below', category: 'Pane',
          shortcut: bindings['split-down'], handler: () => handleSplitPane(activeTab.id, sidebarTerminalId, 'horizontal'),
        });
        if (leaves.length > 1) {
          actions.push({
            id: 'close-pane', label: 'Close current pane', category: 'Pane',
            shortcut: bindings['close-pane'], handler: () => requestClosePane(activeTab.id, sidebarTerminalId),
          });
        }
      }
    }

    return actions;
  }, [
    activeTab, activeTabId, sidebarTerminalId, addTab, requestCloseTab, handleSplitPane, requestClosePane,
    fontSize, persistFontSize, persistTheme, setWorkspaceToolsExpanded, toggleWorkspaceTools, bindings,
  ]);

  const workspaceTools = (
    <Sidebar
      key="workspace-tools"
      section={sidebarSection}
      onSectionChange={setSidebarSection}
      side={sidebarSide}
      expanded={sidebarOpen}
      onExpandedChange={setWorkspaceToolsExpanded}
      explorerSource={explorerSource}
      cwdReady={Boolean(effectiveCwd)}
      isRemote={sidebarIsRemote}
      gitRepository={gitRepository}
      onOpenLocalTabAt={openLocalTabAt}
      onCopyTerminalPath={copyTerminalPath}
      onOpenFile={openEditorFile}
    />
  );

  const runPendingDestructiveAction = async (secondary: boolean) => {
    const action = pendingDestructiveAction;
    const run = secondary ? action?.runSecondary : action?.run;
    if (!action || !run || pendingDestructiveBusy) return;
    setPendingDestructiveBusy(true);
    try {
      const result = await run();
      if (result !== false) {
        setPendingDestructiveAction((current) => current === action ? null : current);
      }
    } finally {
      setPendingDestructiveBusy(false);
    }
  };

  return (
    <div className="app">
      <Titlebar
        onOpenPalette={() => {
          setSettingsOpen(false);
          setPaletteVisible(true);
        }}
        paletteShortcut={bindings['palette-toggle']}
        settingsOpen={settingsOpen}
        onSettingsToggle={() => setSettingsOpen((open) => !open)}
        onSettingsClose={() => setSettingsOpen(false)}
        settingsContent={(
          <div className="titlebar-settings-content">
            <ThemeSwitcher
              currentTheme={currentTheme}
              onThemeChange={persistTheme}
              fontSize={fontSize}
              onFontSizeChange={persistFontSize}
              sidebarSide={sidebarSide}
              onSidebarSideChange={persistSidebarSide}
            />
            <ShortcutEditor />
          </div>
        )}
      />
      <div className={`app-body sidebar-${sidebarSide}`}>
        {sidebarSide === 'left' && workspaceTools}
        {tabsOpen ? (
          <VerticalTabBar
            key="terminal-tabs"
            tabs={tabs}
            activeTabId={activeTabId}
            dirtyTabIds={editorDocuments.dirtyTabIds}
            sshProfiles={sshProfiles}
            sshConnectionsOpen={sshConnectionsOpen}
            onSSHConnectionsOpenChange={setSshConnectionsOpen}
            onSSHConnected={handleSSHConnected}
            onSSHProfilesChange={handleSSHProfilesChange}
            workspaceTabs={workspaceTabs}
            onSelectTab={selectTerminalTab}
            onCloseTab={requestCloseTab}
            onNewTab={() => addTab('local')}
            onWorkspaceTabsChange={handleWorkspaceTabsChange}
            onWorkspaceTabLaunch={openWorkspaceTab}
            onSaveWorkspaceTab={requestSaveWorkspaceTab}
            onRenameTab={renameTab}
            onCollapse={() => {
              responsiveTabsCollapsedRef.current = false;
              setTabsOpen(false);
            }}
          />
        ) : (
          <Tooltip key="terminal-tabs" label="Show terminal tabs" placement="right">
            <button className="tabs-rail" onClick={() => {
              responsiveTabsCollapsedRef.current = false;
              setTabsOpen(true);
            }} aria-label="Show terminal tabs">
              Tabs
            </button>
          </Tooltip>
        )}
        <div key="terminal" className="terminal-area">
          <WorkspaceContent
            tabId={activeTab.id}
            documents={activeDocuments}
            activeSurface={activeDocumentWorkspace.activeSurface}
            themeName={currentTheme}
            fontSize={fontSize}
            fontFamily={fontFamily}
            onSelectSurface={(surface) => editorDocuments.selectSurface(activeTab.id, surface)}
            onDocumentChange={editorDocuments.updateDocumentContent}
            onSaveDocument={(key) => { void saveEditorDocument(key); }}
            onRetryDocument={(key) => { void editorDocuments.retryDocument(key); }}
            onCloseDocument={requestCloseEditorDocument}
            terminal={(
              <SplitPane
                node={activeTab.root}
                tabId={activeTab.id}
                tabType={activeTab.type}
                sshSessionId={activeTab.sshSessionId}
                sshShellReady={activeTab.type !== 'ssh' || activeTab.sshShellReady === true}
                onTerminalReady={handleTerminalReady}
                onTerminalRemoved={handleTerminalRemoved}
                onSplitPane={(leafId, dir) => handleSplitPane(activeTab.id, leafId, dir)}
                onClosePane={(leafId) => requestClosePane(activeTab.id, leafId)}
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
                fontFamily={fontFamily}
                onCwdChange={handleCwdChange}
                onTerminalFocus={handleTerminalFocus}
                initialCwd={activeTab.cwd || homeDir || undefined}
                hasSessionForLeaf={(leafId) => liveTerminalIdsRef.current.has(leafId)}
                isSshSessionDisconnected={isSshSessionDisconnected}
                onSshRetry={handleSshRetry}
              />
            )}
          />
        </div>
        {sidebarSide === 'right' && workspaceTools}
      </div>
      <StatusBar
        sshSessions={sshSessions}
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
      <SnippetPicker
        visible={snippetsVisible}
        onClose={() => setSnippetsVisible(false)}
        snippets={snippets}
        onSave={persistSnippets}
        onPaste={(snippet) => {
          const text = snippetTextForPaste(snippet.content);
          if (sidebarTerminalId && text) requestTerminalPaste(sidebarTerminalId, text);
        }}
      />
      <UpdateBanner />
      <ConfirmationDialog
        open={pendingDestructiveAction !== null}
        title={pendingDestructiveAction?.title ?? ''}
        description={pendingDestructiveAction?.description ?? ''}
        confirmLabel={pendingDestructiveAction?.confirmLabel ?? 'Continue'}
        secondaryLabel={pendingDestructiveAction?.secondaryLabel}
        onSecondary={pendingDestructiveAction?.runSecondary
          ? () => { void runPendingDestructiveAction(true); }
          : undefined}
        busy={pendingDestructiveBusy}
        destructive={pendingDestructiveAction?.destructive ?? true}
        fallbackFocus={pendingDestructiveAction?.fallbackFocus}
        onCancel={() => {
          if (pendingDestructiveBusy) return;
          pendingDestructiveAction?.onCancel?.();
          setPendingDestructiveAction(null);
        }}
        onConfirm={() => { void runPendingDestructiveAction(false); }}
      />
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<any | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [confirmDefaults, setConfirmDefaults] = useState(false);

  const loadSettings = useCallback(() => {
    setSettingsError(false);
    try {
      window.janet.getSettings().then((s: any) => {
        setSettings(s || {});
      }).catch(() => setSettingsError(true));
    } catch {
      setSettingsError(true);
    }
  }, []);

  // Load one coherent settings snapshot before rendering the workspace.
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Persist keybindings to main process
  const handleSave = useCallback((b: Record<KeybindingAction, string>) => {
    try { window.janet.setSettings({ keybindings: b }).catch(() => {}); } catch {}
  }, []);

  if (!settings) {
    return (
      <>
        <div className="app-startup" role={settingsError ? 'alert' : 'status'} aria-live="polite">
          <BrandMark size={56} className="app-startup-mark" />
          <div className="app-startup-name">JaneT</div>
          {settingsError ? (
            <>
              <p>JaneT could not load your workspace settings.</p>
              <div className="app-startup-actions">
                <button type="button" onClick={loadSettings}>Try again</button>
                <button type="button" onClick={() => setConfirmDefaults(true)}>Use defaults</button>
              </div>
            </>
          ) : (
            <p>Restoring your workspace…</p>
          )}
        </div>
        <ConfirmationDialog
          open={confirmDefaults}
          title="Use default settings?"
          description="Start a new default workspace? JaneT will replace saved tabs and custom shortcuts as the default workspace starts and saves."
          confirmLabel="Use defaults"
          fallbackFocus={firstTerminalFocusTarget}
          onCancel={() => setConfirmDefaults(false)}
          onConfirm={() => {
            setConfirmDefaults(false);
            setSettings({});
          }}
        />
      </>
    );
  }

  const initialBindings = settings.keybindings && typeof settings.keybindings === 'object'
    ? settings.keybindings as Record<KeybindingAction, string>
    : {} as Record<KeybindingAction, string>;

  return (
    <KeybindingsProvider initialBindings={initialBindings} onSave={handleSave}>
      <AppInner initialSettings={settings} />
    </KeybindingsProvider>
  );
}
