import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TabInfo, WorkspaceTabPreset, countLeaves, genId, type PaneNode, type TerminalLeaf } from '../types';
import {
  XCloseIcon,
  ChevronsLeftIcon, PlusIcon, ChevronRightIcon, ChevronDownIcon,
} from '../icons';
import WorkspaceForm from './WorkspaceForm';
import { useModalFocus } from '../useModalFocus';
import Tooltip from './Tooltip';
import MainDirectory from './MainDirectory';
import RenameDialog from './RenameDialog';
import { DEFAULT_WORKSPACE_GROUP, MAX_WORKSPACE_GROUPS, isWorkspaceProject, rebaseDirectory, type WorkspaceGroup } from '../../shared/workspaceGroups';
import type { AgentStatus } from '../terminalAwareness';
import type { GitWorktreeInfo } from '../../shared/gitWorktrees';

interface VerticalTabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  groups?: WorkspaceGroup[];
  mainDirectory?: string | null;
  onMainDirectoryChange?: (directory: string) => Promise<void>;
  onRenameGroup?: (id: string, name: string) => Promise<void>;
  onWorkspaceAction?: (action: 'delete' | 'keep' | 'unlink', groupId: string, projectId?: string) => void;
  onGroupsChange: (groups: WorkspaceGroup[]) => void;
  creatorOpen: boolean;
  entryRequest?: import('./EmptyWorkspace').WorkspaceEntryRequest;
  onEntryRequestHandled?: () => void;
  onCreatorOpenChange: (open: boolean) => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
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
  groups = [DEFAULT_WORKSPACE_GROUP],
  mainDirectory,
  onMainDirectoryChange,
  onRenameGroup,
  onWorkspaceAction,
  onGroupsChange,
  creatorOpen,
  entryRequest,
  onEntryRequestHandled,
  onCreatorOpenChange,
  onSelectTab,
  onCloseTab,
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
  const [projectParentId, setProjectParentId] = useState<string | undefined>();
  const [folderError, setFolderError] = useState('');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const directoryDialogRef = useRef<HTMLDivElement>(null);
  const directoryButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: directoryOpen, containerRef: directoryDialogRef, onClose: () => setDirectoryOpen(false), fallbackFocus: () => directoryButtonRef.current });
  const [folderBusy, setFolderBusy] = useState(false);
  const [missingDirectories, setMissingDirectories] = useState<Set<string>>(new Set());
  const [worktreeDirectories, setWorktreeDirectories] = useState<Set<string>>(new Set());
  const projectDirectories = JSON.stringify([...new Set(tabs.filter(tab => tab.cwd).map(tab => tab.cwd!))]);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const directories: string[] = JSON.parse(projectDirectories);
      const linked = await Promise.all(directories.map(async directory => {
        try {
          const trees: GitWorktreeInfo[] | null = await window.janet.gitWorktrees({ repoPath: directory });
          // Git lists the main checkout first; only subsequent entries are linked worktrees.
          return trees?.slice(1).some(tree => !tree.prunable && rebaseDirectory(directory, tree.path, '__worktree__') !== directory) ? directory : null;
        } catch { return null; }
      }));
      if (!cancelled) setWorktreeDirectories(new Set(linked.filter((directory): directory is string => directory !== null)));
    };
    void check();
    window.addEventListener('focus', check);
    return () => { cancelled = true; window.removeEventListener('focus', check); };
  }, [projectDirectories]);
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
    if (!mainDirectory) { setDirectoryOpen(true); return; }
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
    if (!mainDirectory) return setCreationError('Choose a main directory from Workspaces before creating a workspace.');
    if (groups.length >= MAX_WORKSPACE_GROUPS) return setCreationError('The 64-group limit has been reached.');
    setCreating(true); setCreationError('');
    try {
      const directory = await window.janet.workspaceDirectory({ parent: mainDirectory, name });
      onGroupsChange([...groups, { id: genId('group'), name, directory }]);
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
      if (groups.some((item) => item.id !== existing?.id && item.kind === 'folder' && item.directory === directory)) throw new Error('This folder is already linked. Add a project beneath it.');
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
    if (!mainDirectory && target?.kind !== 'folder') { setDirectoryOpen(true); return; }
    setProjectParentId(target?.id);
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

  const workspaceModalOpen = creatorOpen;
  const projectPage = creationKind === 'workspace';
  const projectPageHost = document.getElementById('workspace-main');
  useModalFocus({
    open: workspaceModalOpen && !projectPage,
    containerRef: workspaceModalRef,
    onClose: closeWorkspaceForm,
    initialFocusSelector: 'input',
  });

  return (
    <div className="vtab-bar workspace-tabs-rail" role="group" aria-label="Workspaces">

      <div className="vtab-list workspace-group-list">
      <div className="vtab-header">
        <div className="vtab-heading">
          <button ref={directoryButtonRef} className="workspace-directory-heading" title={mainDirectory ?? 'Choose main directory'} aria-label="Main directory settings" onClick={() => setDirectoryOpen(true)}>Workspaces</button>
        </div>
        <div className="vtab-header-actions">
          <Tooltip label="New workspace" placement="bottom"><button ref={workspaceAddButtonRef} className="vtab-header-btn" aria-label="New workspace" onClick={openWorkspaceForm}><PlusIcon size="sm" /></button></Tooltip>
        </div>
      </div>

        {folderError && <p className="form-error" role="alert">{folderError}</p>}
        {!mainDirectory && <div className="workspace-group-empty">
          <p>Choose a main directory to create workspaces.</p>
          <button type="button" className="connect-btn" onClick={() => setDirectoryOpen(true)}>Set up workspaces</button>
        </div>}
        {(['workspaces', 'folders'] as const).map((section) => <React.Fragment key={section}>
        {section === 'folders' && <div className="folder-section-header"><h2>Library</h2><button className="vtab-header-btn" aria-label="Add Library entry" disabled={folderBusy} onClick={() => void linkFolder()}><PlusIcon size="sm" /></button></div>}
        {section === 'folders' && !groups.some((group) => group.kind === 'folder') && <p className="workspace-group-empty">Link a repo or keep a project here. Library files stay yours.</p>}
        {groups.filter((group) => (group.kind === 'folder') === (section === 'folders')).map((group) => {
          const children = tabs.filter((tab) => (tab.groupId ?? groups[0]?.id) === group.id);
          return <section className="workspace-group" key={group.id} aria-label={group.name}>
            <div className={`workspace-group-heading ${children.some((tab) => tab.id === activeTabId) ? 'active' : ''}`} onContextMenu={(event) => { event.preventDefault(); setTabMenu({ group, opener: event.currentTarget.querySelector('button')!, x: event.clientX, y: event.clientY }); }}>
              <button className="workspace-group-toggle" aria-expanded={!group.collapsed} aria-controls={`group-${group.id}`} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setTabMenu({ group, opener: event.currentTarget, x: rect.left + 12, y: rect.bottom }); } }} onClick={() => onGroupsChange(groups.map((item) => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item))}>
                {group.collapsed ? <ChevronRightIcon size="xs" /> : <ChevronDownIcon size="xs" />}
                <span className="workspace-group-name" title={group.directory || group.name}>{group.name}</span>
              </button>
            </div>
            <div id={`group-${group.id}`} className="workspace-group-children" hidden={group.collapsed}>
            {missingDirectories.has(group.id) && <div className="folder-missing"><span>Folder unavailable</span><button className="folder-locate" disabled={folderBusy} title={group.directory} onClick={() => void linkFolder(group)}>Locate folder<span className="sr-only"> for {group.name}</span></button></div>}
            {children.length === 0 && <p className="workspace-group-empty">No projects yet</p>}
        {children.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isWorktree = Boolean(tab.cwd && worktreeDirectories.has(tab.cwd));
          const leaves = workspaceLeaves(tab.root);
          const editing = editingTabId === tab.id;
          const dirty = dirtyTabIds.has(tab.id);
          const awareness = awarenessByTab[tab.id];
          const locationLabel = leaves.length > 1 ? `Local · ${leaves.length} terminals` : `Local · ${compactLocalTabLabel(tab.cwd ?? leaves[0]?.cwd)}`;
          const subLabel = awareness?.label ?? locationLabel;

          return (
            <div key={tab.id} className="project-entry">
            <div
              role="button"
              aria-pressed={isActive}
              data-tab-id={tab.id}
              aria-label={`${tab.title} ${subLabel}${isWorktree ? ', Worktree project' : ''}${dirty ? ', unsaved editor changes' : ''}`}
              tabIndex={0}
              className={`vtab-item ${isActive ? 'active' : ''}`}
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
                {isWorktree && <span className="vtab-worktree" role="img" aria-label="Worktree project" title="Worktree project">w</span>}
              </div>
              <div className="vtab-meta">
                {!!awareness?.busyCount && <span className="activity-count running" title="Busy terminals">{awareness.busyCount} busy</span>}
                {!!awareness?.unseenCount && <span className="activity-count finished" aria-label={`${awareness.unseenCount} unread results`}>{awareness.unseenCount} new</span>}
                <span className="workspace-group-count" aria-label={`${countLeaves(tab.root)} terminals`}>{countLeaves(tab.root)}</span>

              </div>
            </div>
            </div>
          );
        })}
            </div>
          </section>;
        })}</React.Fragment>)}
      </div>

      <button className="workspace-rail-collapse" onClick={onCollapse} aria-label="Collapse terminal tabs">
        <ChevronsLeftIcon size="sm" /><span>Collapse sidebar</span>
      </button>

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
            <button role="menuitem" onClick={() => {
              setProjectParentId(tabMenu.group!.id);
              closeTabMenu();
              setCreationKind('workspace'); setCreationError(''); onCreatorOpenChange(true);
            }}>Add project</button>
            {tabMenu.group.kind !== 'folder' && <button role="menuitem" onClick={() => { setEditingGroupId(tabMenu.group!.id); setDraftTitle(tabMenu.group!.name); closeTabMenu(); }}>Rename workspace</button>}
            <button role="menuitem" disabled={!onWorkspaceAction} onClick={() => { const group = tabMenu.group!; closeTabMenu(); onWorkspaceAction?.(group.kind === 'folder' || !group.directory ? 'unlink' : 'delete', group.id); }}>{tabMenu.group.kind === 'folder' ? 'Remove from Library…' : !tabMenu.group.directory ? 'Remove workspace…' : 'Delete workspace…'}</button>
          </>}
          {tabMenu.tab && <>
          <button role="menuitem" onClick={() => { startRename(tabMenu.tab!); closeTabMenu(); }}>
            {isWorkspaceProject(tabMenu.tab, groups) ? 'Rename project' : 'Rename session'}
          </button>
          {isWorkspaceProject(tabMenu.tab, groups) && <>
            {groups.find(group => group.id === tabMenu.tab!.groupId)?.kind !== 'folder' && <button role="menuitem" disabled={!onWorkspaceAction} onClick={() => { const tab = tabMenu.tab!; closeTabMenu(); onWorkspaceAction?.('keep', tab.groupId!, tab.id); }}>Keep in Library…</button>}
            <button role="menuitem" disabled={!onWorkspaceAction} onClick={() => { const tab = tabMenu.tab!; closeTabMenu(); onWorkspaceAction?.(tab.isProject && groups.find(group => group.id === tab.groupId)?.kind === 'folder' ? 'unlink' : 'delete', tab.groupId!, tab.id); }}>{tabMenu.tab.isProject && groups.find(group => group.id === tabMenu.tab!.groupId)?.kind === 'folder' ? 'Remove project…' : 'Delete project…'}</button>
          </>}
          <button role="menuitem" disabled={isWorkspaceProject(tabMenu.tab, groups) && countLeaves(tabMenu.tab.root) === 0} onClick={() => { const id = tabMenu.tab!.id; closeTabMenu(); onCloseTab(id); }}>{isWorkspaceProject(tabMenu.tab, groups) ? 'Close all terminals…' : 'Close session'}</button>
          </>}
        </div>,
        document.body,
      )}
      <RenameDialog open={editingGroupId !== null} title="Rename workspace" inputLabel="Workspace name" initialValue={draftTitle}
        fallbackFocus={() => workspaceAddButtonRef.current} onCancel={() => setEditingGroupId(null)}
        onSave={async (name) => { if (editingGroupId) { if (onRenameGroup) await onRenameGroup(editingGroupId, name); else onGroupsChange(groups.map((item) => item.id === editingGroupId ? { ...item, name } : item)); } setEditingGroupId(null); }} />
      {directoryOpen && createPortal(<div className="workspace-modal-overlay"><div ref={directoryDialogRef} className="workspace-modal" role="dialog" aria-modal="true" aria-label="Main directory settings">
        <div className="workspace-modal-header"><h2>Workspace location</h2><button aria-label="Close main directory settings" onClick={() => setDirectoryOpen(false)}><XCloseIcon size="sm" /></button></div>
        <MainDirectory directory={mainDirectory ?? null} onChange={async (directory) => { await onMainDirectoryChange?.(directory); setDirectoryOpen(false); }} />
      </div></div>, document.body)}
      {workspaceModalOpen && createPortal(
        <div
          className={projectPage ? "empty-project-setup workspace-creation-page" : "workspace-modal-overlay"}
          role="presentation"
          onPointerDown={(event) => {
            if (!projectPage && event.target === event.currentTarget) closeWorkspaceForm();
          }}
        >
          <div
            ref={workspaceModalRef}
            className={projectPage ? "project-creation-content" : "workspace-modal"}
            role={projectPage ? "region" : "dialog"}
            aria-modal={projectPage ? undefined : true}
            aria-labelledby="workspace-modal-title"
          >
            <div className="workspace-modal-header">
              <h2 id="workspace-modal-title">{creationKind === 'group' ? 'Create workspace' : 'Create project'}</h2>
              {projectPage ? <button className="project-creation-cancel" disabled={creating} onClick={closeWorkspaceForm}>Cancel</button> : <Tooltip label="Close creation dialog" placement="left">
                <button onClick={closeWorkspaceForm} aria-label="Close creation dialog">
                  <XCloseIcon size="sm" />
                </button>
              </Tooltip>}
            </div>

            {creationError && <p role="alert" className="form-error">{creationError}</p>}
            {creationKind === 'group' && !mainDirectory ? <MainDirectory directory={null} onChange={async (directory) => { await onMainDirectoryChange?.(directory); onCreatorOpenChange(false); }} /> : creationKind === 'group' ? <form className="workspace-form" onSubmit={createGroup}>
              <label className="form-field"><span>Workspace name</span><input className="form-input" aria-label="Workspace name" required maxLength={128} value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Personal" /></label>
              <p className="workspace-form-help">Creates a folder in your main directory. Add projects inside this workspace when you are ready.</p>
              <button className="connect-btn" disabled={creating || !groupName.trim()} type="submit">{creating ? 'Creating…' : 'Create workspace'}</button>
            </form> : <WorkspaceForm
              group={groups.find(group => group.id === projectParentId)}
              submitting={creating}
              submitLabel={creating ? 'Opening terminals…' : 'Create project'}
              onSubmit={createWorkspace}
            />}
          </div>
        </div>,
        projectPage && projectPageHost ? projectPageHost : document.body,
      )}
    </div>
  );
}
