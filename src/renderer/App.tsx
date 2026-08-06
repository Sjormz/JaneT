import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import Titlebar from './components/Titlebar';
import VerticalTabBar from './components/VerticalTabBar';
import SplitPane from './components/SplitPane';
import { disposeCachedTerminal } from './components/TerminalPane';
import Sidebar, { WorkspaceToolSection } from './components/Sidebar';
import StatusBar from './components/StatusBar';
import CommandPalette, { CommandAction } from './components/CommandPalette';
import SnippetPicker from './components/SnippetPicker';
import CommandHistoryPicker from './components/CommandHistoryPicker';
import ShortcutEditor from './components/ShortcutEditor';
import ThemeSwitcher from './components/ThemeSwitcher';
import UpdateBanner from './components/UpdateBanner';
import BrandMark from './components/BrandMark';
import Tooltip from './components/Tooltip';
import ConfirmationDialog from './components/ConfirmationDialog';
import RenameDialog from './components/RenameDialog';
import WorkspaceContent, { surfaceTabFocusTarget } from './components/WorkspaceContent';
import { ArrowRightIcon } from './icons';
import {
  TabInfo, SessionInfo,
  SavedSSHProfile,
  WorkspaceTabPreset,
  PaneNode, PaneDropSide, TerminalLeaf,
  createPaneRoot, splitPane, removePane, movePane, resizePane, getAllLeafIds, genId, mapLeaves, findLeaf, countLeaves,
} from './types';
import { ThemeName, applyCssTheme, getTheme } from './themes';
import { KeybindingsProvider, useKeybindings } from './KeybindingsContext';
import { KeybindingAction } from './keybindings';
import {
  serializePaneTree, restorePaneTree, normalizeSession, SavedSession,
  MAX_RESTORED_TABS, MAX_RESTORED_TERMINALS,
} from './sessionRestore';
import { GitStatusSummary, summarizeGitStatus } from './gitStatus';
import { useGitRepository } from './useGitRepository';
import { requestTerminalSearch } from './terminalSearch';
import { requestTerminalPaste } from './terminalPaste';
import { formatTerminalPathForPaste } from './terminalPathDrag';
import type { FileExplorerSource } from './fileExplorerSource';
import type { SemanticCommandEvent, SemanticCommandStartedEvent } from './semanticCommands';
import type { CommandNotificationPayload } from '../shared/commandNotifications';
import { DEFAULT_TERMINAL_FONT_FAMILY, normalizeTerminalFontFamily } from '../shared/typography';
import { useEditorDocuments } from './useEditorDocuments';
import { emptyTabDocumentWorkspace, isEditorDocumentDirty, type EditorResource } from './editorDocuments';
import { snippetTextForPaste, type Snippet } from '../shared/snippets';
import { MAX_COMMAND_HISTORY_ENTRIES, type CommandHistoryEntry } from '../shared/commandHistory';
import {
  acknowledgeAgentAwareness,
  aggregateAgentStatus,
  applyAgentEvent,
  terminalStatus,
  type AgentAwareness,
  type AgentLifecycleEvent,
  type TerminalTransportStatus,
} from './terminalAwareness';

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

type RenameTarget =
  | { kind: 'pane'; tabId: string; leafId: string; terminalId: string; initialValue: string }
  | { kind: 'tab'; tabId: string; terminalId: string | null; initialValue: string };

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

function ownsSshTerminal(tabs: TabInfo[], termId: string, sessionId: string): boolean {
  return tabs.some((tab) => collectTerminalOwners(tab).some(
    (owner) => owner.termId === termId && owner.type === 'ssh' && owner.sshSessionId === sessionId,
  ));
}

function preferredLeafId(tab: TabInfo, focusedTerminalId: string | null, maximizedLeafId?: string | null): string | null {
  const leaves = getAllLeafIds(tab.root);
  if (maximizedLeafId && leaves.includes(maximizedLeafId)) return maximizedLeafId;
  if (focusedTerminalId && leaves.includes(focusedTerminalId)) return focusedTerminalId;
  return leaves[0] ?? null;
}

function firstTerminalFocusTarget(): HTMLTextAreaElement | null {
  const containers = Array.from(document.querySelectorAll<HTMLElement>('[data-terminal-focus-target]'));
  const container = containers.find((candidate) => candidate.offsetParent !== null) ?? containers[0];
  return container?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
}

function terminalFocusTarget(termId: string | null): HTMLTextAreaElement | null {
  if (!termId) return firstTerminalFocusTarget();
  const container = Array.from(document.querySelectorAll<HTMLElement>('[data-terminal-id]'))
    .find((candidate) => candidate.dataset.terminalId === termId);
  return container?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
}

function displayPaneTitle(leaf: TerminalLeaf, tabType: 'local' | 'ssh'): string {
  const stored = leaf.title?.trim();
  const leafType = leaf.terminalType ?? tabType;
  const legacyTitle = leafType === 'ssh' ? 'ssh' : 'terminal';
  const isLegacyUntypedSplitTitle = !leaf.terminalType && stored?.toLowerCase() === 'terminal';
  if (stored && stored.toLowerCase() !== legacyTitle && !isLegacyUntypedSplitTitle) return stored;
  return leafType === 'ssh' ? 'SSH' : 'Terminal';
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

function sshConnectProfile(profile: SavedSSHProfile, profiles: SavedSSHProfile[]) {
  const jumpHost = profile.jumpHostProfileId
    ? profiles.find((candidate) => candidate.id === profile.jumpHostProfileId)
    : undefined;
  if (profile.jumpHostProfileId && (!jumpHost || jumpHost.id === profile.id)) {
    throw new Error('Saved jump host is missing or invalid');
  }
  return {
    host: profile.host, port: profile.port,
    ...(profile.username ? { username: profile.username } : {}), auth: profile.auth,
    password: profile.auth === 'password' ? profile.password : undefined,
    privateKey: profile.auth === 'key' ? profile.privateKey : undefined,
    ...(jumpHost ? { jumpHost: {
      host: jumpHost.host, port: jumpHost.port,
      ...(jumpHost.username ? { username: jumpHost.username } : {}), auth: jumpHost.auth,
      ...(jumpHost.auth === 'password' && jumpHost.password ? { password: jumpHost.password } : {}),
      ...(jumpHost.auth === 'key' && jumpHost.privateKey ? { privateKey: jumpHost.privateKey } : {}),
    } } : {}),
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
  commandHistory: CommandHistoryEntry[];
  notificationsEnabled: boolean;
  notificationThresholdSeconds: number;
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
    commandHistory: Array.isArray(s.commandHistory) ? s.commandHistory : [],
    notificationsEnabled: s.notificationsEnabled === true,
    notificationThresholdSeconds: Number.isInteger(s.notificationThresholdSeconds) ? s.notificationThresholdSeconds : 10,
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
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const [sidebarOpen, setSidebarOpen] = useState(initialState.sidebarOpen);
  const [tabsOpen, setTabsOpen] = useState(initialState.tabsOpen);
  const responsiveTabsCollapsedRef = useRef(false);
  const [sidebarSection, setSidebarSection] = useState<WorkspaceToolSection>(initialState.sidebarSection);
  const [sshSessions, setSshSessions] = useState<SessionInfo[]>([]);
  const sshSessionsRef = useRef(sshSessions);
  sshSessionsRef.current = sshSessions;
  const [readySshSessionIds, setReadySshSessionIds] = useState<Set<string>>(new Set());
  const [disconnectedSshSessionIds, setDisconnectedSshSessionIds] = useState<Set<string>>(new Set());
  const [sshConnectionEpochById, setSshConnectionEpochById] = useState<Record<string, number>>({});
  const [sshProfiles, setSshProfiles] = useState<SavedSSHProfile[]>(initialState.sshProfiles);
  const sshProfilesRef = useRef(sshProfiles);
  sshProfilesRef.current = sshProfiles;
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTabPreset[]>(initialState.workspaceTabs);
  const [maximizedLeafByTab, setMaximizedLeafByTab] = useState<Record<string, string | null>>({});
  const [broadcastRecipientIds, setBroadcastRecipientIds] = useState<Set<string>>(new Set());
  const [broadcastArmed, setBroadcastArmed] = useState(false);
  const [broadcastConfirmationOpen, setBroadcastConfirmationOpen] = useState(false);
  const broadcastRecipientIdsRef = useRef(broadcastRecipientIds);
  broadcastRecipientIdsRef.current = broadcastRecipientIds;
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [paneDropTarget, setPaneDropTarget] = useState<{ leafId: string; side: PaneDropSide } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const liveTerminalIdsRef = useRef<Set<string>>(new Set());
  const restoreTerminalFocusRef = useRef(false);
  const terminalFocusTargetIdRef = useRef<string | null>(null);
  const terminalLastFocusedRef = useRef<Record<string, number>>({});
  const terminalFocusSequenceRef = useRef(0);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const connectingSshSessionIdsRef = useRef<Set<string>>(new Set());
  const releasedSshSessionIdsRef = useRef<Set<string>>(new Set());
  const invalidatedInitialSshShellsRef = useRef(new Map<string, string>());
  const sshShellStateByTerminalRef = useRef(new Map<string, { sessionId: string; state: 'ready' | 'failed' }>());
  const terminalStatusAnnouncementEligibleIdsRef = useRef(new Set<string>());

  useLayoutEffect(() => {
    if (!restoreTerminalFocusRef.current) return;
    const target = terminalFocusTarget(terminalFocusTargetIdRef.current);
    if (!target) return;
    restoreTerminalFocusRef.current = false;
    terminalFocusTargetIdRef.current = null;
    target.focus();
  }, [activeTabId, tabs, terminalFocusRequest]);

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

  const markSshSessionDisconnected = useCallback((sessionId: string) => {
    for (const [termId, shell] of sshShellStateByTerminalRef.current) {
      if (shell.sessionId === sessionId) sshShellStateByTerminalRef.current.delete(termId);
    }
    setSshSessions((current) => current.filter((session) => session.id !== sessionId));
    setReadySshSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    setDisconnectedSshSessionIds((current) => new Set(current).add(sessionId));
  }, []);

  const markSshSessionUnavailable = useCallback((sessionId: string) => {
    setReadySshSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
    setDisconnectedSshSessionIds((current) => new Set(current).add(sessionId));
  }, []);

  const markSshTerminalReady = useCallback((termId: string, sessionId: string, explicitRetry = false) => {
    if (!explicitRetry && invalidatedInitialSshShellsRef.current.get(termId) === sessionId) return;
    if (releasedSshSessionIdsRef.current.has(sessionId)) return;
    if (!ownsSshTerminal(tabsRef.current, termId, sessionId)) return;
    sshShellStateByTerminalRef.current.set(termId, { sessionId, state: 'ready' });
    markSshSessionReady(sessionId);
  }, [markSshSessionReady]);

  const markSshTerminalFailed = useCallback((termId: string, sessionId: string, explicitRetry = false) => {
    if (!explicitRetry && invalidatedInitialSshShellsRef.current.get(termId) === sessionId) return;
    if (!ownsSshTerminal(tabsRef.current, termId, sessionId)) return;
    if (explicitRetry) {
      announcedTerminalStatusByIdRef.current.delete(termId);
      terminalStatusAnnouncementEligibleIdsRef.current.add(termId);
    }
    sshShellStateByTerminalRef.current.set(termId, { sessionId, state: 'failed' });
    const owners = tabsRef.current.flatMap(collectTerminalOwners).filter(
      (owner) => owner.type === 'ssh' && owner.sshSessionId === sessionId,
    );
    if (owners.length > 0 && owners.every((owner) => (
      sshShellStateByTerminalRef.current.get(owner.termId)?.state === 'failed'
    ))) {
      markSshSessionUnavailable(sessionId);
    }
  }, [markSshSessionUnavailable]);

  const isSshSessionDisconnected = useCallback((sessionId?: string) => (
    Boolean(sessionId && disconnectedSshSessionIds.has(sessionId))
  ), [disconnectedSshSessionIds]);

  useEffect(() => {
    if (!window.janet.onSSHConnectionClosed) return undefined;
    return window.janet.onSSHConnectionClosed(({ id }) => {
      releasedSshSessionIdsRef.current.add(id);
      const disconnectedTerminals = tabsRef.current.flatMap(collectTerminalOwners)
        .filter((owner) => owner.sshSessionId === id);
      disconnectedTerminals.forEach((owner) => {
        terminalStatusAnnouncementEligibleIdsRef.current.add(owner.termId);
      });
      for (const owner of disconnectedTerminals) {
        invalidatedInitialSshShellsRef.current.set(owner.termId, id);
      }
      clearPendingCommandHistoryRuns(new Set(disconnectedTerminals.map((owner) => owner.termId)));
      const disconnectedRecipient = disconnectedTerminals
        .some((owner) => broadcastRecipientIdsRef.current.has(owner.termId));
      if (disconnectedRecipient) setBroadcastRecipientIds(new Set());
      markSshSessionDisconnected(id);
      setSshConnectionEpochById((current) => ({
        ...current,
        [id]: (current[id] ?? 0) + 1,
      }));
    });
  }, [markSshSessionDisconnected]);

  const restoredSshTabsStartedRef = useRef(false);
  const restoredSshLeavesStartedRef = useRef(false);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [snippetsVisible, setSnippetsVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(initialState.settingsOpen);
  const [shortcutsVisible, setShortcutsVisible] = useState(false);
  const [sshConnectionsOpen, setSshConnectionsOpen] = useState(initialState.sshConnectionsOpen);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction | null>(null);
  const [pendingDestructiveBusy, setPendingDestructiveBusy] = useState(false);
  const pendingDestructiveBusyRef = useRef(false);
  const pendingDestructiveFocusRef = useRef<(() => HTMLElement | null) | undefined>(undefined);
  const editorDocuments = useEditorDocuments();

  useEffect(() => {
    if (pendingDestructiveAction !== null) return;
    const fallbackFocus = pendingDestructiveFocusRef.current;
    pendingDestructiveFocusRef.current = undefined;
    fallbackFocus?.()?.focus();
  }, [pendingDestructiveAction]);

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
  const cwdByTerminalRef = useRef(cwdByTerminal);
  const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);
  const [awarenessByTerminal, setAwarenessByTerminal] = useState<Record<string, AgentAwareness>>({});
  const [localTransportByTerminal, setLocalTransportByTerminal] = useState<Record<string, TerminalTransportStatus>>({});
  const [terminalStatusAnnouncement, setTerminalStatusAnnouncement] = useState({ sequence: 0, text: '' });
  const announcedTerminalStatusByIdRef = useRef(new Map<string, string>());
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
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>(initialState.commandHistory);
  const commandHistoryRef = useRef(commandHistory);
  const historySaveQueueRef = useRef(Promise.resolve());
  const pendingCommandHistoryRunsRef = useRef(new Map<string, {
    id: string;
    termId: string;
    removed?: boolean;
    completing?: boolean;
  }>());
  const [runningCommandHistoryIds, setRunningCommandHistoryIds] = useState<Set<string>>(new Set());
  const [notificationsEnabled, setNotificationsEnabled] = useState(initialState.notificationsEnabled);
  const [notificationThresholdSeconds, setNotificationThresholdSeconds] = useState(initialState.notificationThresholdSeconds);
  const settingsLoadedRef = useRef(true);

  const clearPendingCommandHistoryRuns = useCallback((terminalIds: ReadonlySet<string>) => {
    const clearedIds = new Set<string>();
    for (const [key, run] of pendingCommandHistoryRunsRef.current) {
      if (!terminalIds.has(run.termId)) continue;
      if (!run.completing) pendingCommandHistoryRunsRef.current.delete(key);
      clearedIds.add(run.id);
    }
    if (clearedIds.size) setRunningCommandHistoryIds((current) => (
      new Set([...current].filter((id) => !clearedIds.has(id)))
    ));
  }, []);

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
        markSshSessionDisconnected(tab.sshSessionId!);
        continue;
      }
      const sessionId = tab.sshSessionId!;
      if (connectingSshSessionIdsRef.current.has(sessionId)) {
        continue;
      }
      connectingSshSessionIdsRef.current.add(sessionId);
      window.janet.sshConnect({
        id: sessionId,
        ...sshConnectProfile(profile, sshProfiles),
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
        setTabs((prev) => prev.map((existing) => (
          existing.id === tab.id ? { ...existing, sshShellReady: true } : existing
        )));
      }).catch((err) => {
        console.error('Failed to reconnect saved SSH tab:', err);
        markSshSessionDisconnected(sessionId);
      }).finally(() => {
        connectingSshSessionIdsRef.current.delete(sessionId);
        releasedSshSessionIdsRef.current.delete(sessionId);
      });
    }
  }, [markSshSessionDisconnected, sshProfiles]);

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
        markSshSessionDisconnected(leaf.sshSessionId);
        continue;
      }
      if (connectingSshSessionIdsRef.current.has(leaf.sshSessionId)) {
        continue;
      }
      connectingSshSessionIdsRef.current.add(leaf.sshSessionId);
      window.janet.sshConnect({
        id: leaf.sshSessionId, ...sshConnectProfile(profile, sshProfiles),
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
        setTabs((current) => current.map((tab) => tab.id === leaf.tabId
          ? { ...tab, root: mapLeaves(tab.root, (candidate) => candidate.id === leaf.leafId ? { ...candidate, sshShellReady: true } : candidate) }
          : tab));
      }).catch((error) => {
        console.error('Failed to reconnect saved workspace SSH terminal:', error);
        markSshSessionDisconnected(leaf.sshSessionId);
      })
        .finally(() => {
          connectingSshSessionIdsRef.current.delete(leaf.sshSessionId);
          releasedSshSessionIdsRef.current.delete(leaf.sshSessionId);
        });
    }
  }, [markSshSessionDisconnected, sshProfiles]);

  const persistSession = useCallback(async (): Promise<boolean> => {
    const session: SavedSession = {
      tabs: tabsRef.current.map((tab) => ({
        id: tab.id,
        title: tab.title,
        type: tab.type,
        cwd: tab.cwd,
        sshProfileId: tab.sshProfileId,
        root: serializePaneTree(tab.root, cwdByTerminalRef.current, { includeStartupCommands: true }),
      })),
      activeTabId,
      sidebarOpen,
      tabsOpen: responsiveTabsCollapsedRef.current ? true : tabsOpen,
      sidebarSection,
    };
    try {
      await window.janet.setSettings({ session });
      return true;
    } catch {
      return false;
    }
  }, [activeTabId, cwdByTerminal, sidebarOpen, sidebarSection, tabsOpen]);

  // Debounce normal changes, but the close handshake below forces a flush.
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    const timer = setTimeout(() => { void persistSession(); }, 500);
    return () => clearTimeout(timer);
  }, [persistSession, tabs]);

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

  const persistNotificationsEnabled = useCallback((enabled: boolean) => {
    setNotificationsEnabled(enabled);
    window.janet.setSettings({ notificationsEnabled: enabled }).catch(() => {});
  }, []);

  const persistNotificationThreshold = useCallback((seconds: number) => {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) return;
    setNotificationThresholdSeconds(seconds);
    window.janet.setSettings({ notificationThresholdSeconds: seconds }).catch(() => {});
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
      const next = tabsRef.current.map((tab) => (
        tab.id === tabId ? updater(tab) : tab
      ));
      tabsRef.current = next;
      setTabs(next);
    },
    [],
  );

  const terminalCount = useCallback(() => (
    tabsRef.current.reduce((total, tab) => total + countLeaves(tab.root), 0)
  ), []);
  const canAddTerminalTab = useCallback(() => (
    tabsRef.current.length < MAX_RESTORED_TABS && terminalCount() < MAX_RESTORED_TERMINALS
  ), [terminalCount]);

  // Track terminal registrations
  const handleTerminalReady = useCallback((termId: string) => {
    liveTerminalIdsRef.current.add(termId);
    if (!restoreTerminalFocusRef.current) return;
    const target = terminalFocusTarget(terminalFocusTargetIdRef.current);
    if (!target) return;
    restoreTerminalFocusRef.current = false;
    terminalFocusTargetIdRef.current = null;
    target.focus();
  }, []);

  useEffect(() => {
    if (!window.janet.onTerminalExit) return undefined;
    return window.janet.onTerminalExit(({ id }) => {
      const owner = tabsRef.current.flatMap(collectTerminalOwners)
        .find((candidate) => candidate.termId === id);
      if (owner?.type !== 'local') return;
      terminalStatusAnnouncementEligibleIdsRef.current.add(id);
      if (broadcastRecipientIdsRef.current.has(id)) setBroadcastRecipientIds(new Set());
      setLocalTransportByTerminal((current) => (
        current[id] === 'exited' ? current : { ...current, [id]: 'exited' }
      ));
      clearPendingCommandHistoryRuns(new Set([id]));
    });
  }, [clearPendingCommandHistoryRuns]);

  // Called by TerminalPane when the shell reports a new cwd (via OSC 7
  // parsed from the PTY stream). Only the focused terminal's cwd drives
  // the sidebar, but we still store the cwd for every terminal so that
  // switching focus is instant.
  const handleCwdChange = useCallback((termId: string, cwd: string) => {
    if (cwdByTerminalRef.current[termId] === cwd) return;
    const next = { ...cwdByTerminalRef.current, [termId]: cwd };
    cwdByTerminalRef.current = next;
    setCwdByTerminal(next);
  }, []);

  // Called by TerminalPane when a terminal gains focus. We track this
  // so the sidebar can react when the user clicks between split panes.
  const handleTerminalFocus = useCallback((termId: string) => {
    terminalLastFocusedRef.current[termId] = ++terminalFocusSequenceRef.current;
    setFocusedTerminalId(termId);
  }, []);

  const handleAgentEvent = useCallback((termId: string, event: AgentLifecycleEvent) => {
    const owner = tabsRef.current.find((tab) => getAllLeafIds(tab.root).includes(termId));
    if (!owner) return;
    setAwarenessByTerminal((current) => {
      const nextAwareness = applyAgentEvent(
        current[termId], event, Date.now(), owner.id === activeTabIdRef.current,
      );
      if (nextAwareness === current[termId]) return current;
      terminalStatusAnnouncementEligibleIdsRef.current.add(termId);
      if (nextAwareness) return { ...current, [termId]: nextAwareness };
      if (!(termId in current)) return current;
      const { [termId]: _removed, ...next } = current;
      return next;
    });
  }, []);

  const resolveCommandHistoryContext = useCallback((tabId: string, termId: string): CommandHistoryEntry['context'] | null => {
    const owner = tabsRef.current.find((tab) => tab.id === tabId);
    const leaf = owner && findLeaf(owner.root, termId);
    if (!owner || !leaf) return null;
    if ((leaf.terminalType ?? owner.type) === 'local') {
      const cwd = cwdByTerminalRef.current[termId] || leaf.cwd || owner.cwd || homeDir;
      return cwd ? { kind: 'local', cwd } : null;
    }
    const session = sshSessionsRef.current.find((candidate) => candidate.id === (leaf.sshSessionId ?? owner.sshSessionId));
    const profile = sshProfilesRef.current.find((candidate) => candidate.id === (leaf.sshProfileId ?? owner.sshProfileId));
    const host = session?.host ?? profile?.host;
    if (!host) return null;
    const username = session?.username ?? profile?.username;
    const port = session?.port ?? profile?.port;
    return { kind: 'ssh', label: `${username ? `${username}@` : ''}${host}${port ? `:${port}` : ''}` };
  }, [homeDir]);

  const handleSemanticCommandStarted = useCallback((
    tabId: string, termId: string, event: SemanticCommandStartedEvent,
  ) => {
    const key = `${tabId}\u0000${termId}\u0000${event.startedAt}\u0000${event.command}`;
    if (pendingCommandHistoryRunsRef.current.has(key)) return;
    const run: { id: string; termId: string; removed?: boolean } = { id: crypto.randomUUID(), termId };
    pendingCommandHistoryRunsRef.current.set(key, run);
    historySaveQueueRef.current = historySaveQueueRef.current.then(async () => {
      const context = resolveCommandHistoryContext(tabId, termId);
      if (!context || run.removed) {
        if (pendingCommandHistoryRunsRef.current.get(key) === run) pendingCommandHistoryRunsRef.current.delete(key);
        return;
      }
      const entry: CommandHistoryEntry = {
        id: run.id, command: event.command, startedAt: event.startedAt, durationMs: 0, context,
      };
      const next = [entry, ...commandHistoryRef.current.filter((candidate) => candidate.command !== entry.command)]
        .slice(0, MAX_COMMAND_HISTORY_ENTRIES);
      try {
        await window.janet.setSettings({ commandHistory: next });
        commandHistoryRef.current = next;
        setCommandHistory(next);
        if (pendingCommandHistoryRunsRef.current.get(key) === run) {
          setRunningCommandHistoryIds((current) => new Set(current).add(run.id));
        }
      } catch (error) {
        if (pendingCommandHistoryRunsRef.current.get(key) === run) pendingCommandHistoryRunsRef.current.delete(key);
        console.error('Failed to save command history:', error);
      }
    });
  }, [resolveCommandHistoryContext]);

  const handleSemanticCommandCancelled = useCallback((
    tabId: string, termId: string, event: SemanticCommandStartedEvent,
  ) => {
    const key = `${tabId}\u0000${termId}\u0000${event.startedAt}\u0000${event.command}`;
    const run = pendingCommandHistoryRunsRef.current.get(key);
    if (!run) return;
    pendingCommandHistoryRunsRef.current.delete(key);
    setRunningCommandHistoryIds((current) => {
      if (!current.has(run.id)) return current;
      const next = new Set(current);
      next.delete(run.id);
      return next;
    });
  }, []);

  const handleSemanticCommand = useCallback((tabId: string, termId: string, event: SemanticCommandEvent) => {
    const owners = tabsRef.current.filter((tab) => (
      tab.id === tabId && getAllLeafIds(tab.root).includes(termId)
    ));
    if (owners.length !== 1) return;
    const owner = owners[0];
    const leaf = findLeaf(owner.root, termId);
    if (!leaf) return;
    const leafType = leaf.terminalType ?? owner.type;
    const payload: CommandNotificationPayload = {
      durationMs: event.durationMs,
      outcome: event.exitCode === undefined ? 'unknown' : event.exitCode === 0 ? 'success' : 'failure',
      tabLabel: owner.title.trim().slice(0, 256) || 'Terminal',
      paneLabel: displayPaneTitle(leaf, owner.type).slice(0, 256),
      context: leafType === 'ssh'
        ? { kind: 'ssh', hostLabel: (sshProfiles.find((profile) => profile.id === (leaf.sshProfileId ?? owner.sshProfileId))?.host ?? 'SSH').slice(0, 512) }
        : { kind: 'local' },
    };
    window.janet.notifyCommandCompleted(payload).catch(() => {});

    const key = `${tabId}\u0000${termId}\u0000${event.startedAt}\u0000${event.command}`;
    const run = pendingCommandHistoryRunsRef.current.get(key);
    if (run) run.completing = true;
    historySaveQueueRef.current = historySaveQueueRef.current.then(async () => {
      const context = resolveCommandHistoryContext(tabId, termId);
      if (run?.removed) {
        if (pendingCommandHistoryRunsRef.current.get(key) === run) pendingCommandHistoryRunsRef.current.delete(key);
        return;
      }
      if (!context) {
        if (run && pendingCommandHistoryRunsRef.current.get(key) === run) {
          pendingCommandHistoryRunsRef.current.delete(key);
        }
        return;
      }
      const trackedRun = run && pendingCommandHistoryRunsRef.current.get(key) === run ? run : undefined;
      if (trackedRun && commandHistoryRef.current.find((candidate) => candidate.command === event.command)?.id !== trackedRun.id) {
        if (pendingCommandHistoryRunsRef.current.get(key) === trackedRun) pendingCommandHistoryRunsRef.current.delete(key);
        setRunningCommandHistoryIds((current) => {
          const updated = new Set(current);
          updated.delete(trackedRun.id);
          return updated;
        });
        return;
      }
      const entry: CommandHistoryEntry = {
        id: trackedRun?.id ?? crypto.randomUUID(), command: event.command, startedAt: event.startedAt,
        durationMs: event.durationMs,
        ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }), context,
      };
      const next = [
        entry,
        ...commandHistoryRef.current.filter((candidate) => candidate.command !== entry.command),
      ].slice(0, MAX_COMMAND_HISTORY_ENTRIES);
      try {
        await window.janet.setSettings({ commandHistory: next });
        commandHistoryRef.current = next;
        setCommandHistory(next);
        if (trackedRun) {
          if (pendingCommandHistoryRunsRef.current.get(key) === trackedRun) pendingCommandHistoryRunsRef.current.delete(key);
          setRunningCommandHistoryIds((current) => {
            const updated = new Set(current);
            updated.delete(trackedRun.id);
            return updated;
          });
        }
      } catch (error) {
        if (trackedRun) {
          if (pendingCommandHistoryRunsRef.current.get(key) === trackedRun) pendingCommandHistoryRunsRef.current.delete(key);
          setRunningCommandHistoryIds((current) => {
            const updated = new Set(current);
            updated.delete(trackedRun.id);
            return updated;
          });
        }
        console.error('Failed to save command history:', error);
      }
    });
  }, [resolveCommandHistoryContext, sshProfiles]);

  const removeCommandHistoryEntry = useCallback((entry: CommandHistoryEntry) => {
    historySaveQueueRef.current = historySaveQueueRef.current.then(async () => {
      const next = commandHistoryRef.current.filter((candidate) => candidate.id !== entry.id);
      if (next.length === commandHistoryRef.current.length) return;
      try {
        await window.janet.setSettings({ commandHistory: next });
        for (const run of pendingCommandHistoryRunsRef.current.values()) {
          if (run.id === entry.id) run.removed = true;
        }
        commandHistoryRef.current = next;
        setCommandHistory(next);
        setRunningCommandHistoryIds((current) => {
          if (!current.has(entry.id)) return current;
          const updated = new Set(current);
          updated.delete(entry.id);
          return updated;
        });
      } catch (error) {
        console.error('Failed to remove command history entry:', error);
      }
    });
  }, []);

  const transportByTerminal = useMemo(() => Object.fromEntries(
    tabs.flatMap((tab) => collectTerminalOwners(tab).flatMap((owner) => {
      const transport = owner.type === 'local'
        ? localTransportByTerminal[owner.termId]
        : owner.sshSessionId && disconnectedSshSessionIds.has(owner.sshSessionId)
          ? 'disconnected' as const
          : undefined;
      return transport ? [[owner.termId, transport]] : [];
    })),
  ), [disconnectedSshSessionIds, localTransportByTerminal, tabs]);

  const awarenessByTab = useMemo(() => Object.fromEntries(
    tabs.flatMap((tab) => {
      const terminalIds = getAllLeafIds(tab.root);
      const status = aggregateAgentStatus(
        terminalIds.map((termId) => awarenessByTerminal[termId]),
        terminalIds.map((termId) => transportByTerminal[termId]),
      );
      return status ? [[tab.id, status]] : [];
    }),
  ), [awarenessByTerminal, tabs, transportByTerminal]);

  useEffect(() => {
    const previous = announcedTerminalStatusByIdRef.current;
    const next = new Map<string, string>();
    const announcements: string[] = [];
    const eligibleIds = terminalStatusAnnouncementEligibleIdsRef.current;
    let changed = false;
    for (const tab of tabs) {
      const owners = collectTerminalOwners(tab);
      const paneLabels = owners.map((owner) => {
        const leaf = findLeaf(tab.root, owner.termId);
        if (!leaf) return '';
        const paneTitle = displayPaneTitle(leaf, tab.type).slice(0, 256);
        const paneType = (leaf.terminalType ?? tab.type) === 'ssh' ? 'SSH' : 'Local terminal';
        return `${paneTitle} — ${paneType} pane`;
      });
      for (const [ownerIndex, owner] of owners.entries()) {
        const awareness = awarenessByTerminal[owner.termId];
        const status = terminalStatus(awareness, transportByTerminal[owner.termId]);
        if (!status) {
          if (previous.has(owner.termId)) changed = true;
          continue;
        }
        const occurrence = ['finished', 'failed', 'interrupted'].includes(status.kind)
          ? `${status.kind}:${awareness?.turnId ?? awareness?.lastTurn?.endedAt ?? ''}`
          : status.kind;
        next.set(owner.termId, occurrence);
        if (previous.get(owner.termId) === occurrence) continue;
        changed = true;
        if (!eligibleIds.has(owner.termId)
          || status.kind === 'ready' || status.kind === 'running') continue;
        const tabLabel = tab.title.trim().slice(0, 256) || 'Terminal';
        const paneLabel = paneLabels[ownerIndex];
        if (!paneLabel) continue;
        const paneIdentity = paneLabels.indexOf(paneLabel) === paneLabels.lastIndexOf(paneLabel)
          ? paneLabel
          : `${paneLabel} ${ownerIndex + 1}`;
        announcements.push(`${tabLabel} · ${paneIdentity} · ${status.label}`);
      }
    }
    if ([...previous.keys()].some((termId) => !next.has(termId))) changed = true;
    announcedTerminalStatusByIdRef.current = next;
    eligibleIds.clear();
    if (announcements.length) {
      setTerminalStatusAnnouncement((current) => ({
        sequence: current.sequence + 1,
        text: announcements.join('. '),
      }));
    } else if (changed) {
      setTerminalStatusAnnouncement((current) => (
        current.text ? { ...current, text: '' } : current
      ));
    }
  }, [awarenessByTerminal, tabs, transportByTerminal]);

  const selectTerminalTab = useCallback((tabId: string) => {
    setBroadcastRecipientIds(new Set());
    const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
    if (tab) {
      const ownedTerminals = new Set(getAllLeafIds(tab.root));
      setAwarenessByTerminal((current) => {
        let changed = false;
        const next = { ...current };
        for (const termId of ownedTerminals) {
          const awareness = current[termId];
          if (!awareness) continue;
          const acknowledged = acknowledgeAgentAwareness(awareness);
          if (acknowledged !== awareness) {
            next[termId] = acknowledged;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }
    restoreTerminalFocusRef.current = true;
    terminalFocusTargetIdRef.current = null;
    setActiveTabId(tabId);
    editorDocuments.selectSurface(tabId, 'terminal');
    setTerminalFocusRequest((request) => request + 1);
  }, [editorDocuments.selectSurface]);

  const teardownTerminalOwners = useCallback((owners: TerminalOwner[], remainingTabs: TabInfo[]) => {
    if (owners.length === 0) return;

    const removedTerminals = new Set(owners.map((owner) => owner.termId));
    clearPendingCommandHistoryRuns(removedTerminals);
    setBroadcastRecipientIds((current) => (
      [...current].some((termId) => removedTerminals.has(termId)) ? new Set() : current
    ));
    setLocalTransportByTerminal((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([termId]) => !removedTerminals.has(termId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setAwarenessByTerminal((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([termId]) => !removedTerminals.has(termId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });

    const retainedSshSessions = new Set(
      remainingTabs.flatMap(collectTerminalOwners)
        .filter((owner) => owner.type === 'ssh' && owner.sshSessionId)
        .map((owner) => owner.sshSessionId!),
    );
    const releasedSshSessions = new Set<string>();

    for (const owner of owners) {
      invalidatedInitialSshShellsRef.current.delete(owner.termId);
      sshShellStateByTerminalRef.current.delete(owner.termId);
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

    for (const sessionId of retainedSshSessions) {
      if (!owners.some((owner) => owner.sshSessionId === sessionId)) continue;
      const remainingOwners = remainingTabs.flatMap(collectTerminalOwners).filter(
        (owner) => owner.type === 'ssh' && owner.sshSessionId === sessionId,
      );
      if (remainingOwners.length > 0 && remainingOwners.every((owner) => (
        sshShellStateByTerminalRef.current.get(owner.termId)?.state === 'failed'
      ))) {
        markSshSessionUnavailable(sessionId);
      }
    }

    for (const sessionId of releasedSshSessions) {
      if (connectingSshSessionIdsRef.current.has(sessionId)) {
        releasedSshSessionIdsRef.current.add(sessionId);
      }
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
  }, [clearPendingCommandHistoryRuns, markSshSessionUnavailable]);

  // Called when a TerminalPane unmounts
  const handleTerminalRemoved = useCallback(
    (termId: string) => {
      window.setTimeout(() => {
        const stillRendered = tabsRef.current.some((tab) => getAllLeafIds(tab.root).includes(termId));
        if (stillRendered) return;

        setCwdByTerminal((current) => {
          if (!(termId in current)) return current;
          const { [termId]: _removed, ...next } = current;
          return next;
        });
        setAwarenessByTerminal((current) => {
          if (!(termId in current)) return current;
          const { [termId]: _removed, ...next } = current;
          return next;
        });
        setLocalTransportByTerminal((current) => {
          if (!(termId in current)) return current;
          const { [termId]: _removed, ...next } = current;
          return next;
        });
        liveTerminalIdsRef.current.delete(termId);
        if (!disposeCachedTerminal(termId)) return;
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
    ): boolean => {
      if (!canAddTerminalTab()) {
        return false;
      }
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
      const next = [...tabsRef.current, tab];
      setBroadcastRecipientIds(new Set());
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(tab.id);
      return true;
    },
    [canAddTerminalTab, tabs.length],
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
      const shouldRestoreTerminalFocus = activeTabId === tabId;
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
      restoreTerminalFocusRef.current = shouldRestoreTerminalFocus;
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
    const closesLastDocument = editorDocuments.documents
      .filter((candidate) => candidate.ownerTabId === document.ownerTabId).length === 1;
    const focusAfterClose = () => (
      closesLastDocument ? firstTerminalFocusTarget() : fallbackFocus() ?? firstTerminalFocusTarget()
    );
    if (!isEditorDocumentDirty(document)) {
      editorDocuments.closeDocument(key);
      requestAnimationFrame(() => focusAfterClose()?.focus());
      return;
    }
    setPendingDestructiveAction({
      title: `Save changes to ${document.title}?`,
      description: 'This file has unsaved changes. Save them before closing, or explicitly discard the editor contents.',
      confirmLabel: "Don't Save",
      run: () => editorDocuments.closeDocument(key),
      secondaryLabel: 'Save',
      runSecondary: () => saveEditorDocument(key, () => editorDocuments.closeDocument(key)),
      fallbackFocus: focusAfterClose,
    });
  }, [editorDocuments.closeDocument, editorDocuments.documents, saveEditorDocument]);

  const renameTab = useCallback((tabId: string, title: string) => {
    const normalized = title.trim();
    if (!normalized) return;
    updateTab(tabId, (tab) => ({ ...tab, title: normalized }));
  }, [updateTab]);

  // === Split / close pane ===

  const handleSplitPane = useCallback(
    (tabId: string, leafId: string, direction: 'horizontal' | 'vertical') => {
      if (terminalCount() >= MAX_RESTORED_TERMINALS) return;
      const next = tabsRef.current.map((tab) => tab.id === tabId
        ? { ...tab, root: splitPane(tab.root, leafId, direction) }
        : tab);
      tabsRef.current = next;
      setTabs(next);
    },
    [terminalCount],
  );

  const handleToggleMaximizePane = useCallback((tabId: string, leafId: string) => {
    setBroadcastRecipientIds(new Set());
    setFocusedTerminalId(leafId);
    setMaximizedLeafByTab((prev) => ({
      ...prev,
      [tabId]: prev[tabId] === leafId ? null : leafId,
    }));
  }, []);

  const handleBroadcastRecipientChange = useCallback((termId: string, selected: boolean) => {
    setBroadcastRecipientIds((current) => {
      const next = new Set(current);
      if (selected) next.add(termId);
      else next.delete(termId);
      if (!broadcastArmed && next.size >= 2) setBroadcastConfirmationOpen(true);
      if (next.size < 2) setBroadcastArmed(false);
      return next;
    });
  }, [broadcastArmed]);

  const handleBroadcastInput = useCallback((sourceTermId: string, data: string, binary = false): boolean => {
    const recipients = [...broadcastRecipientIds];
    if (!broadcastArmed || recipients.length < 2 || !broadcastRecipientIds.has(sourceTermId)) return false;
    const activeTab = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    const owners = activeTab ? collectTerminalOwners(activeTab) : [];
    const selectedOwners = recipients.map((termId) => owners.find((owner) => owner.termId === termId));
    const allReady = selectedOwners.every((owner) => owner
      && liveTerminalIdsRef.current.has(owner.termId)
      && localTransportByTerminal[owner.termId] !== 'exited'
      && (owner.type === 'local' || (owner.sshSessionId
        && !disconnectedSshSessionIds.has(owner.sshSessionId)
        && readySshSessionIds.has(owner.sshSessionId))));
    if (!allReady) {
      setBroadcastRecipientIds(new Set());
      return false;
    }
    for (const owner of selectedOwners as TerminalOwner[]) {
      if (owner.type === 'local') {
        if (binary) window.janet.terminalWriteBinary({ id: owner.termId, data, userInput: true });
        else window.janet.terminalWrite({ id: owner.termId, data, userInput: true });
      } else if (binary) {
        window.janet.sshWriteShellBinary({ sessionId: owner.sshSessionId, termId: owner.termId, data, userInput: true });
      } else {
        window.janet.sshWriteShell({ sessionId: owner.sshSessionId, termId: owner.termId, data, userInput: true });
      }
    }
    return true;
  }, [broadcastArmed, broadcastRecipientIds, disconnectedSshSessionIds, localTransportByTerminal, readySshSessionIds]);

  useEffect(() => {
    if (broadcastRecipientIds.size >= 2) return;
    setBroadcastArmed(false);
    setBroadcastConfirmationOpen(false);
  }, [broadcastRecipientIds.size]);

  useEffect(() => {
    if (!broadcastArmed || broadcastRecipientIds.size < 2) return undefined;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setBroadcastArmed(false);
      setBroadcastRecipientIds(new Set());
    };
    window.addEventListener('keydown', cancelOnEscape, true);
    return () => window.removeEventListener('keydown', cancelOnEscape, true);
  }, [broadcastArmed, broadcastRecipientIds.size]);

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
      restoreTerminalFocusRef.current = true;
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
        const persisted = await persistSession();
        await window.janet.resolvePrepareForClose({
          requestId: request.requestId,
          resolution: persisted ? 'saved' : 'cancel',
        });
        return;
      }

      const reason = request.reason === 'update-install'
        ? 'installing the update'
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
          resolution: await persistSession() ? 'discarded' : 'cancel',
        }),
        secondaryLabel: 'Save all and close',
        runSecondary: () => saveEditorDocumentSequence(
          dirtyDocuments.map((document) => document.key),
          async () => window.janet.resolvePrepareForClose({
            requestId: request.requestId,
            resolution: await persistSession() ? 'saved' : 'cancel',
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
    persistSession,
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
      if (!addTab('ssh', session.id, true, session.sshProfileId)) {
        window.janet.sshDisconnect({ id: session.id }).catch(() => {});
        return;
      }
      releasedSshSessionIdsRef.current.delete(session.id);
      setSshSessions((prev) => (
        prev.some((s) => s.id === session.id) ? prev : [...prev, session]
      ));
      setSshConnectionsOpen(false);
    },
    [addTab],
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
    const profile = profileId
      ? sshProfiles.find((candidate) => candidate.id === profileId)
      : undefined;
    const existingSession = sshSessionsRef.current.find((candidate) => candidate.id === sessionId);

    const hasSiblingOwner = () => tabsRef.current.flatMap(collectTerminalOwners).some(
      (owner) => owner.type === 'ssh' && owner.sshSessionId === sessionId && owner.termId !== termId,
    );
    setAwarenessByTerminal((current) => {
      const awareness = current[termId];
      if (!awareness || awareness.phase === 'ready') return current;
      return { ...current, [termId]: { ...awareness, phase: 'ready', phaseChangedAt: Date.now() } };
    });
    sshShellStateByTerminalRef.current.delete(termId);
    if (!hasSiblingOwner()) markSshSessionDisconnected(sessionId);
    try {
      await window.janet.sshCreateShell({
        id: sessionId,
        termId,
        ...dims,
        ...(leaf?.startupCommands?.length ? { startupCommands: leaf.startupCommands } : {}),
        ...(leaf?.startupShellDialect ? { startupShellDialect: leaf.startupShellDialect } : {}),
      });
      if (
        releasedSshSessionIdsRef.current.has(sessionId) ||
        !ownsSshTerminal(tabsRef.current, termId, sessionId)
      ) {
        if (ownsSshSession(tabsRef.current, sessionId)) {
          window.janet.sshDestroyShell({ sessionId, termId }).catch(() => {});
        } else {
          window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
        }
        return;
      }
      const session = existingSession ?? (profile ? sshSessionInfo(sessionId, profile) : undefined);
      if (session) {
        setSshSessions((current) => current.some((candidate) => candidate.id === sessionId)
          ? current
          : [...current, session]);
      }
      markSshTerminalReady(termId, sessionId, true);
    } catch (shellErr) {
      if (!ownsSshTerminal(tabsRef.current, termId, sessionId)) {
        if (!ownsSshSession(tabsRef.current, sessionId)) {
          window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
        }
        return;
      }
      // Shell open failed — the session itself may be dead. Try
      // re-establishing the SSH connection from the saved profile,
      // then re-open the shell. If the profile is missing the user
      // will see the original error and can dismiss the tab.
      if (!profile) {
        markSshTerminalFailed(termId, sessionId, true);
        console.error('SSH retry failed and no saved profile to reconnect from:', shellErr);
        throw shellErr;
      }
      releasedSshSessionIdsRef.current.delete(sessionId);
      connectingSshSessionIdsRef.current.add(sessionId);
      try {
        await window.janet.sshConnect({
          id: sessionId,
          ...sshConnectProfile(profile, sshProfiles),
        });
        if (
          releasedSshSessionIdsRef.current.has(sessionId) ||
          !ownsSshTerminal(tabsRef.current, termId, sessionId)
        ) {
          if (!ownsSshSession(tabsRef.current, sessionId)) {
            window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
          }
          return;
        }
        await window.janet.sshCreateShell({
          id: sessionId,
          termId,
          ...dims,
          ...(leaf?.startupCommands?.length ? { startupCommands: leaf.startupCommands } : {}),
          ...(leaf?.startupShellDialect ? { startupShellDialect: leaf.startupShellDialect } : {}),
        });
        if (
          releasedSshSessionIdsRef.current.has(sessionId) ||
          !ownsSshTerminal(tabsRef.current, termId, sessionId)
        ) {
          if (ownsSshSession(tabsRef.current, sessionId)) {
            window.janet.sshDestroyShell({ sessionId, termId }).catch(() => {});
          } else {
            window.janet.sshDisconnect({ id: sessionId }).catch(() => {});
          }
          return;
        }
        const session = sshSessionInfo(sessionId, profile);
        setSshSessions((current) => current.some((candidate) => candidate.id === sessionId)
          ? current
          : [...current, session]);
        markSshTerminalReady(termId, sessionId, true);
      } catch (reconnectErr) {
        markSshTerminalFailed(termId, sessionId, true);
        console.error('SSH retry failed:', reconnectErr);
        throw reconnectErr;
      } finally {
        connectingSshSessionIdsRef.current.delete(sessionId);
        releasedSshSessionIdsRef.current.delete(sessionId);
      }
    }
  }, [markSshSessionDisconnected, markSshTerminalFailed, markSshTerminalReady, sshProfiles]);

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
    if (tabsRef.current.length >= MAX_RESTORED_TABS
      || terminalCount() + countLeaves(root) > MAX_RESTORED_TERMINALS) {
      return;
    }
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
        markSshSessionDisconnected(leaf.sshSessionId);
        continue;
      }
      releasedSshSessionIdsRef.current.delete(leaf.sshSessionId);
      connectingSshSessionIdsRef.current.add(leaf.sshSessionId);
      try {
        await window.janet.sshConnect({
          id: leaf.sshSessionId, ...sshConnectProfile(profile, sshProfiles),
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
        updateTab(tab.id, (current) => ({ ...current, root: mapLeaves(current.root, (candidate) => candidate.id === leaf.id ? { ...candidate, sshShellReady: true } : candidate) }));
      } catch (error) {
        console.error('Failed to open workspace SSH terminal:', error);
        markSshSessionDisconnected(leaf.sshSessionId);
      } finally {
        connectingSshSessionIdsRef.current.delete(leaf.sshSessionId);
        releasedSshSessionIdsRef.current.delete(leaf.sshSessionId);
      }
    }
  }, [markSshSessionDisconnected, sshProfiles, terminalCount, updateTab]);


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
  const requestRenamePane = useCallback(() => {
    if (!sidebarTerminalId || !sidebarLeaf) return;
    setRenameTarget({
      kind: 'pane',
      tabId: activeTab.id,
      leafId: sidebarTerminalId,
      terminalId: sidebarTerminalId,
      initialValue: displayPaneTitle(sidebarLeaf, activeTab.type),
    });
  }, [activeTab.id, activeTab.type, sidebarLeaf, sidebarTerminalId]);

  const requestRenameTab = useCallback(() => {
    setRenameTarget({
      kind: 'tab',
      tabId: activeTab.id,
      terminalId: sidebarTerminalId,
      initialValue: activeTab.title,
    });
  }, [activeTab.id, activeTab.title, sidebarTerminalId]);

  const saveRename = useCallback((value: string) => {
    if (!renameTarget) return;
    const normalized = value.trim();
    if (renameTarget.kind === 'tab') {
      if (!normalized) return;
      renameTab(renameTarget.tabId, normalized);
    } else {
      updateTab(renameTarget.tabId, (tab) => ({
        ...tab,
        root: mapLeaves(tab.root, (leaf) => leaf.id === renameTarget.leafId
          ? { ...leaf, title: normalized || undefined, terminalType: leaf.terminalType ?? tab.type }
          : leaf),
      }));
    }
    setRenameTarget(null);
  }, [renameTab, renameTarget, updateTab]);
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
  const followingTarget = useMemo(() => ({
    label: sidebarLeaf ? displayPaneTitle(sidebarLeaf, activeTab.type) : activeTab.title,
    path: sidebarIsRemote ? sidebarRemoteLabel : effectiveCwd,
  }), [activeTab.title, activeTab.type, effectiveCwd, sidebarIsRemote, sidebarLeaf, sidebarRemoteLabel]);
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
  const openLocalTerminals = useMemo(() => {
    const terminals: Array<{ terminalId: string; cwd: string; lastFocused: number }> = [];
    const collect = (tab: TabInfo, node: PaneNode) => {
      if (node.type === 'split') {
        node.children.forEach((child) => collect(tab, child));
        return;
      }
      if ((node.terminalType ?? tab.type) !== 'local') return;
      const cwd = cwdByTerminal[node.id] ?? node.cwd ?? tab.cwd;
      if (!cwd) return;
      terminals.push({
        terminalId: node.id,
        cwd,
        lastFocused: terminalLastFocusedRef.current[node.id] ?? 0,
      });
    };
    tabs.forEach((tab) => collect(tab, tab.root));
    return terminals;
  }, [cwdByTerminal, focusedTerminalId, tabs]);
  const openTerminal = useCallback((terminalId: string) => {
    const tab = tabsRef.current.find((candidate) => {
      const leaf = findLeaf(candidate.root, terminalId);
      return leaf && (leaf.terminalType ?? candidate.type) === 'local';
    });
    if (!tab) return;
    terminalFocusTargetIdRef.current = terminalId;
    restoreTerminalFocusRef.current = true;
    setMaximizedLeafByTab((current) => (
      current[tab.id] && current[tab.id] !== terminalId
        ? { ...current, [tab.id]: null }
        : current
    ));
    setFocusedTerminalId(terminalId);
    setActiveTabId(tab.id);
    editorDocuments.selectSurface(tab.id, 'terminal');
    setTerminalFocusRequest((request) => request + 1);
  }, [editorDocuments.selectSurface]);
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
  const activeDocumentKey = activeDocuments.some(
    (document) => document.key === activeDocumentWorkspace.activeSurface,
  ) ? activeDocumentWorkspace.activeSurface : null;
  const documentCloseFallbackFocus = useCallback((key: string) => {
    const index = activeDocuments.findIndex((document) => document.key === key);
    const surfaceIndex = index < 0 ? 0 : Math.min(index + 1, activeDocuments.length - 1);
    return () => surfaceTabFocusTarget(activeTab.id, surfaceIndex) ?? firstTerminalFocusTarget();
  }, [activeDocuments, activeTab.id]);

  const cycleTerminalTab = useCallback((direction: 1 | -1) => {
    const currentTabs = tabsRef.current;
    const index = currentTabs.findIndex((tab) => tab.id === activeTabIdRef.current);
    if (index < 0 || currentTabs.length < 2) return;
    selectTerminalTab(currentTabs[(index + direction + currentTabs.length) % currentTabs.length].id);
  }, [selectTerminalTab]);

  const cycleTerminalPane = useCallback((direction: 1 | -1) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current);
    if (!tab) return;
    const leaves = getAllLeafIds(tab.root);
    const current = preferredLeafId(tab, focusedTerminalId, maximizedLeafByTab[tab.id]);
    const index = current ? leaves.indexOf(current) : -1;
    const target = leaves[(index + direction + leaves.length) % leaves.length];
    if (!target) return;
    terminalFocusTargetIdRef.current = target;
    restoreTerminalFocusRef.current = true;
    setMaximizedLeafByTab((maximized) => (
      maximized[tab.id] && maximized[tab.id] !== target
        ? { ...maximized, [tab.id]: null }
        : maximized
    ));
    setFocusedTerminalId(target);
    editorDocuments.selectSurface(tab.id, 'terminal');
    setTerminalFocusRequest((request) => request + 1);
  }, [editorDocuments.selectSurface, focusedTerminalId, maximizedLeafByTab]);

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
    const unsub8 = on('settings-toggle', () => setSettingsOpen(true));
    const unsub9 = on('font-reset', () => persistFontSize(14));
    const unsub10 = on('previous-tab', () => cycleTerminalTab(-1));
    const unsub11 = on('next-tab', () => cycleTerminalTab(1));
    const unsub12 = on('history-toggle', () => setHistoryVisible(true));
    const unsub13 = on('save-document', () => {
      if (activeDocumentKey) void saveEditorDocument(activeDocumentKey);
    });
    const unsub14 = on('close-document', () => {
      if (activeDocumentKey) requestCloseEditorDocument(
        activeDocumentKey,
        documentCloseFallbackFocus(activeDocumentKey),
      );
    });
    return () => {
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7();
      unsub8(); unsub9(); unsub10(); unsub11(); unsub12(); unsub13(); unsub14();
    };
  }, [
    on, addTab, requestCloseTab, activeTabId, toggleWorkspaceTools, persistFontSize, fontSize,
    cycleTerminalTab, activeDocumentKey, saveEditorDocument, requestCloseEditorDocument,
    documentCloseFallbackFocus,
  ]);

  // Pane handlers depend on the active tab and focused terminal.
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
    const unsub4 = on('rename-pane', requestRenamePane);
    const unsub5 = on('rename-tab', requestRenameTab);
    const unsub6 = on('maximize-pane', () => {
      if (sidebarTerminalId) handleToggleMaximizePane(activeTab.id, sidebarTerminalId);
    });
    const unsub7 = on('focus-next-pane', () => cycleTerminalPane(1));
    const unsub8 = on('focus-previous-pane', () => cycleTerminalPane(-1));
    return () => {
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7(); unsub8();
    };
  }, [
    on, activeTab, sidebarTerminalId, handleSplitPane, requestClosePane,
    requestRenamePane, requestRenameTab, handleToggleMaximizePane, cycleTerminalPane,
  ]);

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
        id: 'previous-tab', label: 'Previous terminal tab', category: 'Tabs',
        shortcut: bindings['previous-tab'], handler: () => cycleTerminalTab(-1),
      },
      {
        id: 'next-tab', label: 'Next terminal tab', category: 'Tabs',
        shortcut: bindings['next-tab'], handler: () => cycleTerminalTab(1),
      },
      {
        id: 'rename-tab', label: 'Rename current tab', category: 'Tabs',
        shortcut: bindings['rename-tab'], handler: requestRenameTab,
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
        id: 'settings-toggle', label: 'Open Settings', category: 'View',
        shortcut: bindings['settings-toggle'], handler: () => setSettingsOpen(true),
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
        id: 'font-reset', label: 'Reset terminal text size', category: 'Settings',
        shortcut: bindings['font-reset'], handler: () => persistFontSize(14),
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
        id: 'history-toggle', label: 'Open command history', category: 'Terminal',
        shortcut: bindings['history-toggle'], handler: () => setHistoryVisible(true),
      },
      {
        id: 'maximize-pane', label: 'Maximize or restore current pane', category: 'Pane',
        shortcut: bindings['maximize-pane'], handler: () => {
          if (sidebarTerminalId) handleToggleMaximizePane(activeTab.id, sidebarTerminalId);
        },
      },
      {
        id: 'focus-next-pane', label: 'Focus next pane', category: 'Pane',
        shortcut: bindings['focus-next-pane'], handler: () => cycleTerminalPane(1),
      },
      {
        id: 'focus-previous-pane', label: 'Focus previous pane', category: 'Pane',
        shortcut: bindings['focus-previous-pane'], handler: () => cycleTerminalPane(-1),
      },
      {
        id: 'save-document', label: 'Save current document', category: 'Editor',
        shortcut: bindings['save-document'], handler: () => {
          if (activeDocumentKey) void saveEditorDocument(activeDocumentKey);
        },
      },
      {
        id: 'close-document', label: 'Close current document', category: 'Editor',
        shortcut: bindings['close-document'], handler: () => {
          if (activeDocumentKey) requestCloseEditorDocument(
            activeDocumentKey,
            documentCloseFallbackFocus(activeDocumentKey),
          );
        },
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
          id: 'rename-pane', label: 'Rename current terminal', category: 'Pane',
          shortcut: bindings['rename-pane'], handler: requestRenamePane,
        });
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
    activeTab, activeTabId, sidebarTerminalId, activeDocumentKey, addTab, requestCloseTab,
    handleSplitPane, requestClosePane, handleToggleMaximizePane, cycleTerminalPane, cycleTerminalTab,
    requestRenamePane, requestRenameTab, saveEditorDocument, requestCloseEditorDocument,
    documentCloseFallbackFocus,
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
      followingTarget={followingTarget}
      openLocalTerminals={openLocalTerminals}
      onOpenTerminal={openTerminal}
      onOpenLocalTabAt={openLocalTabAt}
      onCopyTerminalPath={copyTerminalPath}
      onOpenFile={openEditorFile}
    />
  );

  const runPendingDestructiveAction = async (secondary: boolean) => {
    const action = pendingDestructiveAction;
    const run = secondary ? action?.runSecondary : action?.run;
    if (!action || !run || pendingDestructiveBusyRef.current) return;
    pendingDestructiveBusyRef.current = true;
    setPendingDestructiveBusy(true);
    try {
      const result = await run();
      if (result !== false) {
        pendingDestructiveFocusRef.current = action.fallbackFocus;
        setPendingDestructiveAction((current) => current === action ? null : current);
      }
    } finally {
      pendingDestructiveBusyRef.current = false;
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
              notificationsEnabled={notificationsEnabled}
              notificationThresholdSeconds={notificationThresholdSeconds}
              onNotificationsEnabledChange={persistNotificationsEnabled}
              onNotificationThresholdSecondsChange={persistNotificationThreshold}
            />
            <div className="theme-section shortcut-settings-section">
              <button
                type="button"
                className="shortcut-settings-button"
                onClick={() => { setSettingsOpen(false); setShortcutsVisible(true); }}
                aria-label="Keyboard shortcuts"
                aria-haspopup="dialog"
              >
                <span><strong>Keyboard shortcuts</strong><small>Customize app commands and keys</small></span>
                <ArrowRightIcon size="sm" />
              </button>
            </div>
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
            awarenessByTab={awarenessByTab}
            sshProfiles={sshProfiles}
            sshConnectionsOpen={sshConnectionsOpen}
            onSSHConnectionsOpenChange={setSshConnectionsOpen}
            canConnectSSH={canAddTerminalTab}
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
          <div
            className="sr-only"
            role="status"
            aria-label="Terminal status announcements"
            aria-live="polite"
            aria-atomic="true"
          >
            {terminalStatusAnnouncement.text && (
              <span key={terminalStatusAnnouncement.sequence}>{terminalStatusAnnouncement.text}</span>
            )}
          </div>
          {broadcastArmed && broadcastRecipientIds.size >= 2 && (
            <div className="broadcast-input-banner" role="status" aria-label="Broadcast input active">
              <strong>Broadcast input active · {broadcastRecipientIds.size} panes</strong>
              <button type="button" onClick={() => { setBroadcastArmed(false); setBroadcastRecipientIds(new Set()); }}>Cancel broadcast input</button>
            </div>
          )}
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
                onAgentEvent={handleAgentEvent}
                onSemanticCommandStarted={handleSemanticCommandStarted}
                onSemanticCommandCancelled={handleSemanticCommandCancelled}
                onSemanticCommand={handleSemanticCommand}
                onBroadcastInput={handleBroadcastInput}
                broadcastRecipientIds={broadcastRecipientIds}
                onBroadcastRecipientChange={handleBroadcastRecipientChange}
                awarenessByTerminal={awarenessByTerminal}
                transportByTerminal={transportByTerminal}
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
                onSshShellReady={markSshTerminalReady}
                onSshShellFailed={markSshTerminalFailed}
                onSshRetry={handleSshRetry}
              />
            )}
          />
        </div>
        {sidebarSide === 'right' && workspaceTools}
      </div>
      <StatusBar
        sshSessions={sshSessions.filter((session) => readySshSessionIds.has(session.id))}
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
      <CommandHistoryPicker
        visible={historyVisible}
        entries={commandHistory}
        runningIds={runningCommandHistoryIds}
        onClose={() => setHistoryVisible(false)}
        onRemove={removeCommandHistoryEntry}
        onSelect={(entry) => {
          const tab = tabsRef.current.find((candidate) => candidate.id === activeTabIdRef.current);
          if (!tab) return;
          const termId = preferredLeafId(tab, focusedTerminalId, maximizedLeafByTab[tab.id]);
          const command = entry.command.replace(/[\r\n]+$/, '');
          if (termId && command && findLeaf(tab.root, termId)) requestTerminalPaste(termId, command);
        }}
      />
      <ShortcutEditor
        open={shortcutsVisible}
        onClose={() => {
          setShortcutsVisible(false);
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.titlebar-settings-btn')?.focus());
        }}
      />
      <UpdateBanner />
      <RenameDialog
        open={renameTarget !== null}
        title={renameTarget?.kind === 'tab' ? 'Rename tab' : 'Rename terminal'}
        inputLabel={renameTarget?.kind === 'tab' ? 'Tab name' : 'Terminal name'}
        initialValue={renameTarget?.initialValue ?? ''}
        fallbackFocus={() => terminalFocusTarget(renameTarget?.terminalId ?? null)}
        onCancel={() => setRenameTarget(null)}
        onSave={saveRename}
      />
      <ConfirmationDialog
        open={broadcastConfirmationOpen}
        title="Start broadcast input?"
        description={`All typing and paste, including multiline or destructive commands, will go to ${broadcastRecipientIds.size} selected panes.`}
        confirmLabel="Start broadcast input"
        destructive={false}
        onCancel={() => {
          setBroadcastConfirmationOpen(false);
          setBroadcastArmed(false);
          setBroadcastRecipientIds(new Set());
        }}
        onConfirm={() => {
          setBroadcastConfirmationOpen(false);
          setBroadcastArmed(true);
        }}
      />
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
          if (pendingDestructiveBusyRef.current) return;
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
  const [previousSettingsAvailable, setPreviousSettingsAvailable] = useState(false);
  const [confirmDefaults, setConfirmDefaults] = useState(false);

  const showSettingsError = useCallback(() => {
    try {
      window.janet.getSettingsRecoveryState()
        .then(({ previousAvailable }) => setPreviousSettingsAvailable(previousAvailable))
        .catch(() => setPreviousSettingsAvailable(false))
        .finally(() => setSettingsError(true));
    } catch {
      setPreviousSettingsAvailable(false);
      setSettingsError(true);
    }
  }, []);

  const loadSettings = useCallback(() => {
    setSettingsError(false);
    setPreviousSettingsAvailable(false);
    try {
      window.janet.getSettings().then((s: any) => {
        setSettings(s || {});
      }).catch(showSettingsError);
    } catch {
      showSettingsError();
    }
  }, [showSettingsError]);

  const restorePreviousSettings = useCallback(() => {
    setSettingsError(false);
    try {
      window.janet.restorePreviousSettings()
        .then((s: any) => setSettings(s || {}))
        .catch(showSettingsError);
    } catch {
      showSettingsError();
    }
  }, [showSettingsError]);

  const resetSettings = useCallback(() => {
    setConfirmDefaults(false);
    setSettingsError(false);
    try {
      window.janet.resetSettings()
        .then((s: any) => setSettings(s || {}))
        .catch(showSettingsError);
    } catch {
      showSettingsError();
    }
  }, [showSettingsError]);

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
                {previousSettingsAvailable && (
                  <button type="button" onClick={restorePreviousSettings}>Restore previous</button>
                )}
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
          description="JaneT will permanently replace the unreadable settings file, including saved tabs and custom shortcuts."
          confirmLabel="Use defaults"
          fallbackFocus={firstTerminalFocusTarget}
          onCancel={() => setConfirmDefaults(false)}
          onConfirm={resetSettings}
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
