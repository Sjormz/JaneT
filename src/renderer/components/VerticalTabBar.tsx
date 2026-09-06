import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SessionInfo, TabInfo, SavedSSHProfile, WorkspaceTabPreset, countLeaves, genId, type PaneNode, type TerminalLeaf } from '../types';
import {
  TerminalTabIcon, LockIcon, XCloseIcon, PencilIcon, CheckIcon,
  ChevronsLeftIcon, PlusIcon, ChevronRightIcon, ChevronDownIcon,
} from '../icons';
import WorkspaceForm, { sshProfileLabel } from './WorkspaceForm';
import { useModalFocus } from '../useModalFocus';
import Tooltip from './Tooltip';
import SSHManager from './SSHManager';
import MainDirectory from './MainDirectory';
import RenameDialog from './RenameDialog';
import { DEFAULT_WORKSPACE_GROUP, MAX_WORKSPACE_GROUPS, isWorkspaceProject, type WorkspaceGroup } from '../../shared/workspaceGroups';
import type { AgentStatus } from '../terminalAwareness';
import type { SSHLocalForwardStatus } from '../../main/ssh';

interface VerticalTabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  sshProfiles: SavedSSHProfile[];
  groups?: WorkspaceGroup[];
  mainDirectory?: string | null;
  onMainDirectoryChange?: (directory: string) => Promise<void>;
  onRenameGroup?: (id: string, name: string) => Promise<void>;
  onLocalAt?: (groupId: string, tabId?: string) => Promise<void>;
  onWorkspaceAction?: (action: 'delete' | 'keep' | 'unlink', groupId: string, projectId?: string) => void;
  onGroupsChange: (groups: WorkspaceGroup[]) => void;
  onMoveWorkspace: (id: string, groupId: string) => void;
  creatorOpen: boolean;
  entryRequest?: import('./EmptyWorkspace').WorkspaceEntryRequest;
  onEntryRequestHandled?: () => void;
  onCreatorOpenChange: (open: boolean) => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  sshConnectionsOpen: boolean;
  onSSHConnectionsOpenChange: (open: boolean) => void;
  canConnectSSH?: () => boolean;
  onSSHConnected: (session: SessionInfo, groupId?: string, tabId?: string) => void;
  onSSHProfilesChange: (profiles: SavedSSHProfile[]) => void;
  onWorkspaceTabLaunch: (workspace: WorkspaceTabPreset, group: WorkspaceGroup) => Promise<void>;
  onRenameTab: (id: string, title: string) => void | Promise<void>;
  onCollapse: () => void;
  dirtyTabIds?: ReadonlySet<string>;
  awarenessByTab?: Record<string, AgentStatus>;
}


function compactLocalTabLabel(cwd?: string): string {
  if (!cwd) return 'Home';
  const trimmed = cwd.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '~') return 'Home';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function workspaceLeaves(root: PaneNode): TerminalLeaf[] {
  return root.type === 'leaf' ? [root] : root.children.flatMap(workspaceLeaves);
}


export default function VerticalTabBar({
  tabs,
  activeTabId,
  sshProfiles,
  groups = [DEFAULT_WORKSPACE_GROUP],
  mainDirectory,
  onMainDirectoryChange,
  onRenameGroup,
  onLocalAt,
  onWorkspaceAction,
  onGroupsChange,
  onMoveWorkspace,
  creatorOpen,
  entryRequest,
  onEntryRequestHandled,
  onCreatorOpenChange,
  onSelectTab,
  onCloseTab,
  onNewTab,
  sshConnectionsOpen,
  onSSHConnectionsOpenChange,
  canConnectSSH = () => true,
  onSSHConnected,
  onSSHProfilesChange,
  onWorkspaceTabLaunch,
  onRenameTab,
  onCollapse,
  dirtyTabIds = new Set<string>(),
  awarenessByTab = {},
}: VerticalTabBarProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [creationKind, setCreationKind] = useState<'workspace' | 'group'>('group');
  const [groupName, setGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [creationError, setCreationError] = useState('');
  const [creating, setCreating] = useState(false);
  const [folderTarget, setFolderTarget] = useState<WorkspaceGroup | undefined>();
  const [projectParentId, setProjectParentId] = useState<string | undefined>();
  const [folderError, setFolderError] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [sshTarget, setSshTarget] = useState<{ groupId: string; tabId?: string } | null>(null);
  const directoryDialogRef = useRef<HTMLDivElement>(null);
  const directoryButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: directoryOpen, containerRef: directoryDialogRef, onClose: () => setDirectoryOpen(false), fallbackFocus: () => directoryButtonRef.current });
  const [folderBusy, setFolderBusy] = useState(false);
  const [missingDirectories, setMissingDirectories] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const missing = await Promise.all(groups.filter((group) => group.directory).map(async (group) => {
        try { await window.janet.workspaceDirectory({ parent: group.directory! }); return null; }
        catch { return group.id; }
      }));
      if (!cancelled) setMissingDirectories(new Set(missing.filter((id): id is string => id !== null)));
    };
    void check();
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.removeEventListener('focus', check); };
  }, [groups]);
  const [draftTitle, setDraftTitle] = useState('');
  const [tabMenu, setTabMenu] = useState<{
    tab?: TabInfo;
    group?: WorkspaceGroup;
    x: number;
    y: number;
    opener: HTMLElement;
  } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const closeTabMenu = () => {
    const opener = tabMenu?.opener;
    setTabMenu(null);
    if (opener?.isConnected) opener.focus();
  };
  const [forwardTarget, setForwardTarget] = useState<{ tabId: string; sessionId: string } | null>(null);
  const [forwards, setForwards] = useState<SSHLocalForwardStatus[]>([]);
  const [localPort, setLocalPort] = useState('0');
  const [destinationHost, setDestinationHost] = useState('');
  const [destinationPort, setDestinationPort] = useState('');
  const [forwardError, setForwardError] = useState('');
  const forwardModalRef = useRef<HTMLDivElement>(null);
  const forwardRequestRef = useRef(0);
  const forwardDialogRef = useRef(0);
  const mountedRef = useRef(true);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const workspaceModalRef = useRef<HTMLDivElement>(null);
  const workspaceAddButtonRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!tabMenu || !tabMenuRef.current) return;
    const rect = tabMenuRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(tabMenu.x, window.innerWidth - rect.width));
    const y = Math.max(0, Math.min(tabMenu.y, window.innerHeight - rect.height));
    if (x !== tabMenu.x || y !== tabMenu.y) setTabMenu({ ...tabMenu, x, y });
  }, [tabMenu]);

  useEffect(() => {
    if (!tabMenu) return;
    tabMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!tabMenuRef.current?.contains(event.target as Node)) closeTabMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeTabMenu();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [tabMenu]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      forwardRequestRef.current += 1;
      forwardDialogRef.current += 1;
    };
  }, []);

  const startRename = (tab: TabInfo) => {
    setEditingTabId(tab.id);
    setDraftTitle(tab.title);
  };

  const saveRename = async () => {
    if (!editingTabId) return;
    try {
      await onRenameTab(editingTabId, draftTitle);
      setEditingTabId(null); setDraftTitle(''); setFolderError('');
    } catch (error) { setFolderError(error instanceof Error ? error.message : String(error)); }
  };

  const openTabMenu = (tab: TabInfo, opener: HTMLElement, x: number, y: number) => {
    setTabMenu({ tab, opener, x, y });
  };

  const openWorkspaceForm = () => {
    setFolderTarget(undefined);
    setCreationError('');
    setCreationKind('group');
    onCreatorOpenChange(true);
  };
  const closeWorkspaceForm = () => {
    if (creating) return;
    onCreatorOpenChange(false);
    setCreationError('');
  };
  const createGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    if (groups.length >= MAX_WORKSPACE_GROUPS) return setCreationError('The 64-group limit has been reached.');
    setCreating(true); setCreationError('');
    try {
      const directory = mainDirectory ? await window.janet.workspaceDirectory({ parent: mainDirectory, name }) : undefined;
      onGroupsChange([...groups, { id: genId('group'), name, ...(directory ? { directory } : {}) }]);
      setGroupName(''); onCreatorOpenChange(false);
    } catch (error) { setCreationError(error instanceof Error ? error.message : String(error)); }
    finally { setCreating(false); }
  };
  const linkFolder = async (existing?: WorkspaceGroup) => {
    setFolderBusy(true); setFolderError('');
    try {
      if (!existing && groups.length >= MAX_WORKSPACE_GROUPS) throw new Error('The 64-group/folder limit has been reached.');
      const selected = await window.janet.selectLocalDirectory();
      if (!selected) return;
      const directory = await window.janet.workspaceDirectory({ parent: selected });
      if (groups.some((item) => item.id !== existing?.id && item.kind === 'folder' && item.directory === directory)) throw new Error('This folder is already linked. Start another session beneath it.');
      if (existing) onGroupsChange(groups.map((item) => item.id === existing.id ? { ...item, directory } : item));
      else onGroupsChange([...groups, { id: genId('folder'), name: directory.split(/[\\/]/).filter(Boolean).pop() || directory, directory, kind: 'folder' }]);
    } catch (error) { setFolderError(error instanceof Error ? error.message : String(error)); }
    finally { setFolderBusy(false); }
  };
  const handledEntryRequest = useRef<typeof entryRequest>(undefined);
  useEffect(() => {
    if (!entryRequest || handledEntryRequest.current === entryRequest) return;
    handledEntryRequest.current = entryRequest;
    onEntryRequestHandled?.();
    if (entryRequest.action === 'link') { void linkFolder(); return; }
    const target = groups.find(group => group.id === entryRequest.groupId);
    setFolderTarget(target?.kind === 'folder' ? target : undefined);
    setProjectParentId(target?.kind !== 'folder' ? target?.id : undefined);
    setCreationKind(target ? 'workspace' : 'group');
    setCreationError('');
    onCreatorOpenChange(true);
  }, [entryRequest]);
  const createWorkspace = async (workspace: WorkspaceTabPreset, group: WorkspaceGroup) => {
    setCreating(true);
    setCreationError('');
    try {
      await onWorkspaceTabLaunch(workspace, group);
      onCreatorOpenChange(false);
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : String(error));
    } finally { setCreating(false); }
  };

  const closeForwardDialog = () => {
    forwardRequestRef.current += 1;
    forwardDialogRef.current += 1;
    setForwardTarget(null);
    setForwards([]);
    setForwardError('');
  };
  const isCurrentForwardTarget = (target: { tabId: string; sessionId: string }) => {
    const tab = tabsRef.current.find((candidate) => candidate.id === target.tabId);
    return tab?.type === 'ssh' && tab.sshSessionId === target.sessionId && tab.sshShellReady === true;
  };
  const openForwardDialog = (tab: TabInfo) => {
    if (tab.type !== 'ssh' || !tab.sshSessionId || tab.sshShellReady !== true) return;
    const target = { tabId: tab.id, sessionId: tab.sshSessionId };
    forwardDialogRef.current += 1;
    const request = ++forwardRequestRef.current;
    setForwardTarget(target); setForwards([]); setForwardError('');
    void window.janet.sshListLocalForwards({ sessionId: target.sessionId }).then((listed) => {
      if (forwardRequestRef.current === request && isCurrentForwardTarget(target)) setForwards(listed);
    }).catch((error) => {
      if (forwardRequestRef.current === request && isCurrentForwardTarget(target)) setForwardError(error instanceof Error ? error.message : String(error));
    });
  };
  useEffect(() => {
    if (forwardTarget && !isCurrentForwardTarget(forwardTarget)) closeForwardDialog();
  }, [tabs, forwardTarget]);
  useModalFocus({ open: forwardTarget !== null, containerRef: forwardModalRef, onClose: closeForwardDialog, initialFocusSelector: 'input' });
  const createForward = async (event: React.FormEvent) => {
    event.preventDefault();
    const target = forwardTarget;
    const parsedLocalPort = Number(localPort), parsedDestinationPort = Number(destinationPort);
    if (!target || !isCurrentForwardTarget(target)) return closeForwardDialog();
    if (!Number.isInteger(parsedLocalPort) || parsedLocalPort < 0 || parsedLocalPort > 65535 || !destinationHost || !Number.isInteger(parsedDestinationPort) || parsedDestinationPort < 1 || parsedDestinationPort > 65535) return setForwardError('Enter a valid host and ports.');
    const request = ++forwardRequestRef.current; setForwardError('');
    try {
      const started = await window.janet.sshStartLocalForward({ sessionId: target.sessionId, request: { id: crypto.randomUUID(), localPort: parsedLocalPort, destinationHost, destinationPort: parsedDestinationPort } });
      if (!mountedRef.current || forwardRequestRef.current !== request || !isCurrentForwardTarget(target)) {
        void window.janet.sshStopLocalForward({ sessionId: target.sessionId, id: started.id }).catch(() => {});
        return;
      }
      setForwards((current) => [...current.filter((item) => item.id !== started.id), started]);
    } catch (error) { if (forwardRequestRef.current === request && isCurrentForwardTarget(target)) setForwardError(error instanceof Error ? error.message : String(error)); }
  };
  const stopForward = async (forward: SSHLocalForwardStatus) => {
    const target = forwardTarget;
    if (!target || !isCurrentForwardTarget(target)) return closeForwardDialog();
    const dialog = forwardDialogRef.current; setForwardError('');
    try {
      await window.janet.sshStopLocalForward({ sessionId: target.sessionId, id: forward.id });
      if (forwardDialogRef.current === dialog && isCurrentForwardTarget(target)) setForwards((current) => current.filter((item) => item.id !== forward.id));
    } catch (error) { if (forwardDialogRef.current === dialog && isCurrentForwardTarget(target)) setForwardError(error instanceof Error ? error.message : String(error)); }
  };

  const workspaceModalOpen = creatorOpen;
  useModalFocus({
    open: workspaceModalOpen,
    containerRef: workspaceModalRef,
    onClose: closeWorkspaceForm,
    initialFocusSelector: 'input',
  });

  return (
    <div className="vtab-bar workspace-tabs-rail" role="group" aria-label="Workspaces">
      <div className="vtab-header">
        <div className="vtab-heading">
          <button ref={directoryButtonRef} className="workspace-directory-heading" title={mainDirectory ?? 'Choose main directory'} aria-label="Main directory settings" onClick={() => setDirectoryOpen(true)}>Workspaces</button>
          <span className="vtab-count">{groups.filter((group) => !group.kind).length}</span>
        </div>
        <div className="vtab-header-actions">
          <Tooltip label="New workspace or project" placement="bottom"><button ref={workspaceAddButtonRef} className="vtab-header-btn" onClick={openWorkspaceForm} aria-label="New workspace or project"><PlusIcon size="sm" /></button></Tooltip>
          <Tooltip label="Collapse terminal tabs" placement="bottom">
            <button className="vtab-header-btn" onClick={onCollapse} aria-label="Collapse terminal tabs">
              <ChevronsLeftIcon size="sm" />
            </button>
          </Tooltip>
        </div>
      </div>


      {/* TODO: Review sidebar SSH entry points later. Keep the connection panel implementation for that review.
      {sshConnectionsOpen && (
        <div id="vtab-ssh-connections" className="vtab-ssh-connections">
          <SSHManager
            sshProfiles={sshProfiles}
            canConnect={canConnectSSH}
            onConnected={(session) => sshTarget ? onSSHConnected(session, sshTarget.groupId, sshTarget.tabId) : onSSHConnected(session)}
            onProfilesChange={onSSHProfilesChange}
          />
        </div>
      )}
      */}

      <div className="vtab-list workspace-group-list">
        {folderError && <p className="form-error" role="alert">{folderError}</p>}
        {(['workspaces', 'folders'] as const).map((section) => <React.Fragment key={section}>
        {section === 'folders' && <div className="folder-section-header"><h2>Library</h2><button className="vtab-header-btn" aria-label="Add to Library" disabled={folderBusy} onClick={() => void linkFolder()}><PlusIcon size="sm" /></button></div>}
        {section === 'folders' && !groups.some((group) => group.kind === 'folder') && <p className="workspace-group-empty">Link a repo or keep a project here. Library files stay yours.</p>}
        {groups.filter((group) => (group.kind === 'folder') === (section === 'folders')).map((group) => {
          const children = tabs.filter((tab) => (tab.groupId ?? groups[0]?.id) === group.id);
          const terminalCount = children.reduce((sum, tab) => sum + countLeaves(tab.root), 0);
          return <section className="workspace-group" key={group.id} aria-label={group.name}>
            <div className={`workspace-group-heading ${children.some((tab) => tab.id === activeTabId) ? 'active' : ''}`} onContextMenu={(event) => { event.preventDefault(); setTabMenu({ group, opener: event.currentTarget.querySelector('button')!, x: event.clientX, y: event.clientY }); }}>
              <button className="workspace-group-toggle" aria-expanded={!group.collapsed} aria-controls={`group-${group.id}`} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setTabMenu({ group, opener: event.currentTarget, x: rect.left + 12, y: rect.bottom }); } }} onClick={() => onGroupsChange(groups.map((item) => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item))}>
                {group.collapsed ? <ChevronRightIcon size="xs" /> : <ChevronDownIcon size="xs" />}
                <span className="workspace-group-name" title={group.directory || group.name}>{group.name}</span>
                <span className="workspace-group-count" aria-label={`${terminalCount} terminals`}>{terminalCount}</span>
              </button>
              <Tooltip label="Open terminal here" placement="right">
                <button className="directory-terminal-launch" onClick={() => void onLocalAt?.(group.id).catch((error) => setFolderError(String(error)))} aria-label={`Local terminal in ${group.name}`}><TerminalTabIcon size="sm" /></button>
              </Tooltip>
              {group.kind === 'folder' && <button className="vtab-action folder-session-add" aria-label={`Start new session in ${group.name}`} onClick={() => { setFolderTarget(group); setCreationKind('workspace'); setCreationError(''); onCreatorOpenChange(true); }}><PlusIcon size="xs" /></button>}
              {!group.kind && <button className="vtab-action folder-session-add" aria-label={`New project in ${group.name}`} onClick={() => { setFolderTarget(undefined); setProjectParentId(group.id); setCreationKind('workspace'); setCreationError(''); onCreatorOpenChange(true); }}><PlusIcon size="xs" /></button>}
            </div>
            <div id={`group-${group.id}`} className="workspace-group-children" hidden={group.collapsed}>
              {/* TODO: Review workspace SSH action later; retained but not shown.
              <button aria-expanded={sshConnectionsOpen && sshTarget?.groupId === group.id && !sshTarget.tabId} onClick={() => { const closing = sshConnectionsOpen && sshTarget?.groupId === group.id && !sshTarget.tabId; setSshTarget({ groupId: group.id }); onSSHConnectionsOpenChange(!closing); }} aria-label={`SSH terminal in ${group.name}`}><LockIcon size="xs" />SSH</button>
              */}
            {missingDirectories.has(group.id) && <div className="folder-missing"><span>Folder unavailable</span><button className="folder-locate" disabled={folderBusy} title={group.directory} onClick={() => void linkFolder(group)}>Locate folder<span className="sr-only"> for {group.name}</span></button></div>}
            {children.length === 0 && <p className="workspace-group-empty">{group.kind === 'folder' ? 'No sessions yet' : 'No projects yet'}</p>}
        {children.map((tab) => {
          const isActive = tab.id === activeTabId;
          const leaves = workspaceLeaves(tab.root);
          const sshCount = leaves.filter((leaf) => (leaf.terminalType ?? tab.type) === 'ssh').length;
          const isSSH = sshCount === leaves.length;
          const TabIcon = isSSH ? LockIcon : TerminalTabIcon;
          const editing = editingTabId === tab.id;
          const dirty = dirtyTabIds.has(tab.id);
          const awareness = awarenessByTab[tab.id];
          const profileId = tab.sshProfileId ?? leaves[0]?.sshProfileId;
          const sshProfile = profileId
            ? sshProfiles.find((profile) => profile.id === profileId)
            : undefined;
          const locationLabel = sshCount > 0 && !isSSH
            ? `Local + SSH · ${leaves.length} terminals`
            : leaves.length > 1
              ? `${isSSH ? 'SSH' : 'Local'} · ${leaves.length} terminals`
              : isSSH
            ? `SSH · ${sshProfile ? sshProfileLabel(sshProfile) : 'Saved session'}`
            : `Local · ${compactLocalTabLabel(tab.cwd ?? leaves[0]?.cwd)}`;
          const subLabel = awareness?.label ?? locationLabel;

          return (
            <div key={tab.id} className="project-entry">
            <div
              role="button"
              aria-pressed={isActive}
              data-tab-id={tab.id}
              aria-label={`${tab.title} ${subLabel}${dirty ? ', unsaved editor changes' : ''}`}
              tabIndex={0}
              className={`vtab-item ${isActive ? 'active' : ''} ${isSSH ? 'ssh' : ''}`}
              onClick={() => !editing && onSelectTab(tab.id)}
              onContextMenu={(event) => {
                if (editing) return;
                event.preventDefault();
                openTabMenu(tab, event.currentTarget, event.clientX, event.clientY);
              }}
              onKeyDown={(e) => {
                if (!editing && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  openTabMenu(tab, e.currentTarget, rect.left + 12, rect.top + 12);
                  return;
                }
                if (!editing && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onSelectTab(tab.id);
                }
              }}
            >
              <TabIcon size="sm" className="vtab-icon" />
              <div className="vtab-text">
                {editing ? (
                  <input
                    className="vtab-name-input"
                    value={draftTitle}
                    maxLength={256}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename();
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    autoFocus
                    aria-label="Tab name"
                  />
                ) : (
                  <div className="vtab-name" title={tab.title}>
                    <span className={`activity-dot ${awareness?.kind ?? 'unknown'}`} title={awareness?.label ?? 'Activity detection unavailable'} aria-label={awareness?.label ?? 'Activity detection unavailable'} />
                    {tab.title}
                    {dirty && <span className="vtab-dirty-marker" aria-hidden="true">●</span>}
                  </div>
                )}
              </div>
              <div className="vtab-meta">
                {!!awareness?.busyCount && <span className="activity-count running" title="Busy terminals">{awareness.busyCount} busy</span>}
                {!!awareness?.unseenCount && <span className="activity-count finished" aria-label={`${awareness.unseenCount} unread results`}>{awareness.unseenCount} new</span>}
                <span className="workspace-group-count" aria-label={`${countLeaves(tab.root)} terminals`}>{countLeaves(tab.root)}</span>
                {editing && (
                  <Tooltip label="Save tab name" placement="left">
                    <button
                      className="vtab-action"
                      onClick={(e) => { e.stopPropagation(); saveRename(); }}
                      aria-label="Save tab name"
                    >
                      <CheckIcon size="xs" />
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
              <Tooltip label="Add terminal here" placement="right">
                <button className="directory-terminal-launch" aria-label={`Local terminal in ${isWorkspaceProject(tab, groups) ? 'project' : 'session'} ${tab.title}`} onClick={() => void onLocalAt?.(group.id, tab.id).catch((error) => setFolderError(String(error)))}><TerminalTabIcon size="sm" /></button>
              </Tooltip>
                {/* TODO: Review project SSH action later; retained but not shown.
                <button aria-label={`SSH terminal in project ${tab.title}`} onClick={() => { setSshTarget({ groupId: group.id, tabId: tab.id }); onSSHConnectionsOpenChange(true); }}><LockIcon size="xs" />SSH</button>
                */}
            </div>
          );
        })}
            </div>
          </section>;
        })}</React.Fragment>)}
      </div>

      {tabMenu && createPortal(
        <div
          ref={tabMenuRef}
          className="vtab-context-menu"
          role="menu"
          aria-label={`Actions for ${tabMenu.tab?.title ?? tabMenu.group?.name}`}
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          {tabMenu.group && <>
            <button role="menuitem" onClick={() => { setEditingGroupId(tabMenu.group!.id); setDraftTitle(tabMenu.group!.name); closeTabMenu(); }}>{tabMenu.group.kind === 'folder' ? 'Rename Library entry' : 'Rename workspace'}</button>
            <button role="menuitem" disabled={!onWorkspaceAction} onClick={() => { const group = tabMenu.group!; closeTabMenu(); onWorkspaceAction?.(group.kind === 'folder' || !group.directory ? 'unlink' : 'delete', group.id); }}>{tabMenu.group.kind === 'folder' ? 'Remove from Library…' : !tabMenu.group.directory ? 'Remove workspace…' : 'Delete workspace…'}</button>
          </>}
          {tabMenu.tab && <>
          <button role="menuitem" onClick={() => { startRename(tabMenu.tab!); closeTabMenu(); }}>
            {isWorkspaceProject(tabMenu.tab, groups) ? 'Rename project' : 'Rename session'}
          </button>
          {tabMenu.tab.type === 'ssh' && tabMenu.tab.sshSessionId && tabMenu.tab.sshShellReady === true && (
            <button role="menuitem" onClick={() => { openForwardDialog(tabMenu.tab!); closeTabMenu(); }}>Manage local forwards</button>
          )}
          {isWorkspaceProject(tabMenu.tab, groups) && <>
            <button role="menuitem" disabled={!onWorkspaceAction} onClick={() => { const tab = tabMenu.tab!; closeTabMenu(); onWorkspaceAction?.('keep', tab.groupId!, tab.id); }}>Keep in Library…</button>
            <button role="menuitem" disabled={!onWorkspaceAction} onClick={() => { const tab = tabMenu.tab!; closeTabMenu(); onWorkspaceAction?.('delete', tab.groupId!, tab.id); }}>Delete project…</button>
          </>}
          <button role="menuitem" disabled={isWorkspaceProject(tabMenu.tab, groups) && countLeaves(tabMenu.tab.root) === 0} onClick={() => { const id = tabMenu.tab!.id; closeTabMenu(); onCloseTab(id); }}>{isWorkspaceProject(tabMenu.tab, groups) ? 'Close all terminals…' : 'Close session'}</button>
          </>}
        </div>,
        document.body,
      )}
      {forwardTarget && createPortal(
        <div className="workspace-modal-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) closeForwardDialog(); }}>
          <div ref={forwardModalRef} className="workspace-modal ssh-forward-modal" role="dialog" aria-modal="true" aria-labelledby="ssh-forward-title">
            <div className="workspace-modal-header"><h2 id="ssh-forward-title">SSH local forwards</h2><button onClick={closeForwardDialog} aria-label="Close SSH local forwards"><XCloseIcon size="sm" /></button></div>
            <form className="ssh-forward-form" onSubmit={createForward}>
              <label>Local port<input aria-label="Local port" type="number" min="0" max="65535" required value={localPort} onChange={(event) => setLocalPort(event.target.value)} /></label>
              <label>Destination host<input aria-label="Destination host" required value={destinationHost} onChange={(event) => setDestinationHost(event.target.value)} /></label>
              <label>Destination port<input aria-label="Destination port" type="number" min="1" max="65535" required value={destinationPort} onChange={(event) => setDestinationPort(event.target.value)} /></label>
              <button type="submit" className="connect-btn">Create forward</button>
            </form>
            {forwardError && <div className="form-error" role="alert">{forwardError}</div>}
            <div className="ssh-forward-list" aria-label="Active local forwards">{forwards.length === 0 ? <p>No active forwards</p> : forwards.map((forward) => (
              <div className="ssh-forward-row" key={forward.id}><span><strong>{forward.bindHost}:{forward.localPort}</strong> → {forward.destinationHost}:{forward.destinationPort}</span><button type="button" onClick={() => void stopForward(forward)} aria-label={`Stop forward ${forward.bindHost}:${forward.localPort}`}>Stop</button></div>
            ))}</div>
          </div>
        </div>, document.body,
      )}
      <RenameDialog open={editingGroupId !== null} title={groups.find(group => group.id === editingGroupId)?.kind === 'folder' ? 'Rename Library entry' : 'Rename workspace'} inputLabel={groups.find(group => group.id === editingGroupId)?.kind === 'folder' ? 'Library entry name' : 'Workspace name'} initialValue={draftTitle}
        fallbackFocus={() => workspaceAddButtonRef.current} onCancel={() => setEditingGroupId(null)}
        onSave={async (name) => { if (editingGroupId) { if (onRenameGroup) await onRenameGroup(editingGroupId, name); else onGroupsChange(groups.map((item) => item.id === editingGroupId ? { ...item, name } : item)); } setEditingGroupId(null); }} />
      {directoryOpen && createPortal(<div className="workspace-modal-overlay"><div ref={directoryDialogRef} className="workspace-modal" role="dialog" aria-modal="true" aria-label="Main directory settings">
        <div className="workspace-modal-header"><h2>Workspace location</h2><button aria-label="Close main directory settings" onClick={() => setDirectoryOpen(false)}><XCloseIcon size="sm" /></button></div>
        <MainDirectory directory={mainDirectory ?? null} onChange={async (directory) => { await onMainDirectoryChange?.(directory); setDirectoryOpen(false); }} />
      </div></div>, document.body)}
      {workspaceModalOpen && createPortal(
        <div
          className="workspace-modal-overlay"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeWorkspaceForm();
          }}
        >
          <div
            ref={workspaceModalRef}
            className="workspace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-modal-title"
          >
            <div className="workspace-modal-header">
              <h2 id="workspace-modal-title">{folderTarget ? `New session in ${folderTarget.name}` : creationKind === 'group' ? 'Create workspace' : 'Create project'}</h2>
              <Tooltip label="Close creation dialog" placement="left">
                <button onClick={closeWorkspaceForm} aria-label="Close creation dialog">
                  <XCloseIcon size="sm" />
                </button>
              </Tooltip>
            </div>
            {!folderTarget && <div className="workspace-create-kind" role="group" aria-label="Create type">
              <button type="button" aria-pressed={creationKind === 'group'} onClick={() => setCreationKind('group')} disabled={creating}>Workspace</button>
              <button type="button" aria-pressed={creationKind === 'workspace'} onClick={() => setCreationKind('workspace')} disabled={creating || !groups.some((group) => !group.kind)}>Project</button>
            </div>}
            {creationError && <p role="alert" className="form-error">{creationError}</p>}
            {creationKind === 'group' ? <form className="workspace-form" onSubmit={createGroup}>
              <label className="form-field"><span>Workspace name</span><input className="form-input" aria-label="Workspace name" required maxLength={128} value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Personal" /></label>
              <p className="workspace-form-help">Creates a folder in your main directory. Add projects inside this workspace when you are ready.</p>
              <button className="connect-btn" disabled={creating || !groupName.trim()} type="submit">{creating ? 'Creating…' : 'Create workspace'}</button>
            </form> : <WorkspaceForm
              groups={groups.filter((group) => !group.kind)}
              folder={folderTarget}
              defaultGroupId={projectParentId ?? groups.find((group) => !group.kind && group.id === tabs.find((tab) => tab.id === activeTabId)?.groupId)?.id ?? groups.find((group) => !group.kind)?.id}
              submitting={creating}
              submitLabel={creating ? 'Opening terminals…' : folderTarget ? 'Start session' : 'Create project'}
              onSubmit={createWorkspace}
            />}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
