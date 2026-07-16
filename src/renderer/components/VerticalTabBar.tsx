import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SessionInfo, TabInfo, SavedSSHProfile, WorkspaceTabPreset } from '../types';
import {
  TerminalTabIcon, LockIcon, XCloseIcon, PencilIcon, TrashIcon, CheckIcon,
  ChevronsLeftIcon, ListIcon, PlusIcon, ChevronRightIcon, ChevronDownIcon, ArrowRightIcon,
} from '../icons';
import WorkspaceTabPresetForm, { sshProfileLabel } from './WorkspaceTabPresetForm';
import { useRefreshTask } from '../refreshCoordinator';
import { useModalFocus } from '../useModalFocus';
import Tooltip from './Tooltip';
import ConfirmationDialog from './ConfirmationDialog';
import SSHManager from './SSHManager';
import { sanitizeStartupCommands } from '../../shared/startupCommands';

interface VerticalTabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  sshProfiles: SavedSSHProfile[];
  workspaceTabs: WorkspaceTabPreset[];
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  sshConnectionsOpen: boolean;
  onSSHConnectionsOpenChange: (open: boolean) => void;
  onSSHConnected: (session: SessionInfo) => void;
  onSSHProfilesChange: (profiles: SavedSSHProfile[]) => void;
  onWorkspaceTabsChange: (presets: WorkspaceTabPreset[]) => void;
  onWorkspaceTabLaunch: (preset: WorkspaceTabPreset) => void;
  onSaveWorkspaceTab: (tab: TabInfo) => void;
  onRenameTab: (id: string, title: string) => void;
  onCollapse: () => void;
  dirtyTabIds?: ReadonlySet<string>;
}

function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 30) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function compactLocalTabLabel(cwd?: string): string {
  if (!cwd) return 'Home';
  const trimmed = cwd.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '~') return 'Home';
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || trimmed;
}

function countPresetStartupCommands(node: WorkspaceTabPreset['root']): number {
  if (!node) return 0;
  if (node.type === 'leaf') return sanitizeStartupCommands(node.startupCommands).length;
  return node.children.reduce((total, child) => total + countPresetStartupCommands(child), 0);
}

export default function VerticalTabBar({
  tabs,
  activeTabId,
  sshProfiles,
  workspaceTabs,
  onSelectTab,
  onCloseTab,
  onNewTab,
  sshConnectionsOpen,
  onSSHConnectionsOpenChange,
  onSSHConnected,
  onSSHProfilesChange,
  onWorkspaceTabsChange,
  onWorkspaceTabLaunch,
  onSaveWorkspaceTab,
  onRenameTab,
  onCollapse,
  dirtyTabIds = new Set<string>(),
}: VerticalTabBarProps) {
  const [, setNow] = useState(Date.now());
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [workspacesExpanded, setWorkspacesExpanded] = useState(false);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [editingPreset, setEditingPreset] = useState<WorkspaceTabPreset | null>(null);
  const [presetPendingDeletion, setPresetPendingDeletion] = useState<WorkspaceTabPreset | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [tabMenu, setTabMenu] = useState<{ tab: TabInfo; x: number; y: number } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const workspaceModalRef = useRef<HTMLDivElement>(null);
  const workspaceAddButtonRef = useRef<HTMLButtonElement>(null);
  const [tabTimestamps, setTabTimestamps] = useState<Record<string, Date>>(() => {
    const map: Record<string, Date> = {};
    for (const tab of tabs) map[tab.id] = new Date();
    return map;
  });

  useRefreshTask({
    key: 'ui:relative-time',
    intervalMs: 30_000,
    run: () => setNow(Date.now()),
  });

  useEffect(() => {
    setTabTimestamps((prev) => {
      const next = { ...prev };
      for (const tab of tabs) if (!next[tab.id]) next[tab.id] = new Date();
      return next;
    });
  }, [tabs]);

  useEffect(() => {
    if (!tabMenu) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!tabMenuRef.current?.contains(event.target as Node)) setTabMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown, true);
  }, [tabMenu]);

  const startRename = (tab: TabInfo) => {
    setEditingTabId(tab.id);
    setDraftTitle(tab.title);
  };

  const saveRename = () => {
    if (!editingTabId) return;
    onRenameTab(editingTabId, draftTitle.trim());
    setEditingTabId(null);
    setDraftTitle('');
  };

  const openTabMenu = (event: React.MouseEvent, tab: TabInfo) => {
    event.preventDefault();
    setTabMenu({ tab, x: event.clientX, y: event.clientY });
  };

  const openWorkspaceForm = () => {
    setEditingPreset(null);
    setShowWorkspaceForm((visible) => !visible);
  };

  const closeWorkspaceForm = () => {
    setShowWorkspaceForm(false);
    setEditingPreset(null);
  };

  const editPreset = (preset: WorkspaceTabPreset) => {
    setShowWorkspaceForm(false);
    setEditingPreset(preset);
  };

  const closePresetEditor = () => {
    setEditingPreset(null);
  };

  const savePreset = (preset: WorkspaceTabPreset) => {
    if (editingPreset) {
      onWorkspaceTabsChange(workspaceTabs.map((existing) => (existing.id === editingPreset.id ? preset : existing)));
    } else {
      onWorkspaceTabsChange([...workspaceTabs, preset]);
    }
    if (!editingPreset) onWorkspaceTabLaunch(preset);
    closeWorkspaceForm();
    closePresetEditor();
  };

  const confirmDeletePreset = () => {
    if (!presetPendingDeletion) return;
    onWorkspaceTabsChange(workspaceTabs.filter((preset) => preset.id !== presetPendingDeletion.id));
    setPresetPendingDeletion(null);
  };

  const workspaceModalOpen = showWorkspaceForm || editingPreset !== null;
  useModalFocus({
    open: workspaceModalOpen,
    containerRef: workspaceModalRef,
    onClose: closeWorkspaceForm,
    initialFocusSelector: 'input',
  });

  return (
    <div className="vtab-bar" role="group" aria-label="Terminal tabs">
      <div className="vtab-header">
        <div className="vtab-heading">
          <span className="vtab-title">Tabs</span>
          <span className="vtab-count">{tabs.length}</span>
        </div>
        <div className="vtab-header-actions">
          <Tooltip label="Collapse terminal tabs" placement="bottom">
            <button className="vtab-header-btn" onClick={onCollapse} aria-label="Collapse terminal tabs">
              <ChevronsLeftIcon size="sm" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="vtab-create-actions" role="group" aria-label="Create terminal">
        <button
          type="button"
          className="vtab-create-btn"
          onClick={onNewTab}
          aria-label="New local terminal tab"
        >
          <TerminalTabIcon size="sm" />
          <span>Local</span>
        </button>
        <button
          type="button"
          className={`vtab-create-btn ${sshConnectionsOpen ? 'active' : ''}`}
          onClick={() => onSSHConnectionsOpenChange(!sshConnectionsOpen)}
          aria-label="SSH connections"
          aria-expanded={sshConnectionsOpen}
          aria-controls="vtab-ssh-connections"
        >
          <LockIcon size="sm" />
          <span>SSH</span>
        </button>
      </div>

      {sshConnectionsOpen && (
        <div id="vtab-ssh-connections" className="vtab-ssh-connections">
          <SSHManager
            sshProfiles={sshProfiles}
            onConnected={onSSHConnected}
            onProfilesChange={onSSHProfilesChange}
          />
        </div>
      )}

      <div className="vtab-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isSSH = tab.type === 'ssh';
          const TabIcon = isSSH ? LockIcon : TerminalTabIcon;
          const relTime = tabTimestamps[tab.id] ? formatRelativeTime(tabTimestamps[tab.id]) : 'now';
          const editing = editingTabId === tab.id;
          const dirty = dirtyTabIds.has(tab.id);
          const sshProfile = tab.sshProfileId
            ? sshProfiles.find((profile) => profile.id === tab.sshProfileId)
            : undefined;
          const subLabel = isSSH
            ? `SSH · ${sshProfile ? sshProfileLabel(sshProfile) : 'Saved session'}`
            : `Local · ${compactLocalTabLabel(tab.cwd)}`;
          const subTitle = isSSH
            ? sshProfile ? sshProfileLabel(sshProfile) : tab.sshSessionId || 'SSH session'
            : tab.cwd || 'Home directory';

          return (
            <div
              key={tab.id}
              role="button"
              aria-pressed={isActive}
              aria-label={`${tab.title} ${subLabel}${dirty ? ', unsaved editor changes' : ''}`}
              tabIndex={0}
              className={`vtab-item ${isActive ? 'active' : ''} ${isSSH ? 'ssh' : ''}`}
              onClick={() => !editing && onSelectTab(tab.id)}
              onContextMenu={(event) => !editing && openTabMenu(event, tab)}
              onKeyDown={(e) => {
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
                    {tab.title}
                    {dirty && <span className="vtab-dirty-marker" aria-hidden="true">●</span>}
                  </div>
                )}
                <div className="vtab-sub" title={subTitle}>
                  {subLabel}
                </div>
              </div>
              <div className="vtab-meta">
                <span className="vtab-time">{relTime}</span>
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
                <Tooltip label={`Close ${tab.title}`} placement="left">
                  <button
                    className="vtab-close"
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                    aria-label={`Close ${tab.title}`}
                  >
                    <XCloseIcon size="xs" />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>

      <div className="workspace-section">
        <Tooltip label={workspacesExpanded ? 'Collapse presets' : 'Expand presets'} placement="right">
          <button
            className="workspace-section-header"
            onClick={() => setWorkspacesExpanded((expanded) => !expanded)}
            aria-expanded={workspacesExpanded}
            aria-label="Presets"
          >
            <span className="workspace-section-chevron">
              {workspacesExpanded ? <ChevronDownIcon size="xs" /> : <ChevronRightIcon size="xs" />}
            </span>
            <span className="workspace-section-title">
              <ListIcon size="xs" /> Presets
            </span>
            <span className="workspace-section-count">{workspaceTabs.length}</span>
          </button>
        </Tooltip>

        {workspacesExpanded && (
          <div className="workspace-section-content">
            <button
              ref={workspaceAddButtonRef}
              className="workspace-add-btn"
              onClick={openWorkspaceForm}
              aria-label="New preset"
            >
              <PlusIcon size="xs" /> New preset
            </button>

            {workspaceTabs.length === 0 ? (
              <div className="workspace-empty">No presets saved</div>
            ) : (
              <div className="workspace-list">
                {workspaceTabs.map((preset) => {
                  const sshProfile = sshProfiles.find((profile) => profile.id === preset.sshProfileId);
                  const subtitle = preset.type === 'ssh'
                    ? sshProfile ? sshProfileLabel(sshProfile) : 'Missing SSH profile'
                    : preset.cwd || 'Home directory';
                  const startupCommandCount = countPresetStartupCommands(preset.root);

                  return (
                    <div className="workspace-item" key={preset.id}>
                      <div className="workspace-item-main">
                        <TerminalTabIcon size="md" className="workspace-item-icon" />
                        <div className="workspace-item-text">
                          <span className="workspace-item-name">{preset.name}</span>
                          <span className="workspace-item-sub">
                            {preset.terminalCount} terminal{preset.terminalCount === 1 ? '' : 's'}
                            {startupCommandCount > 0 && ` · ${startupCommandCount} startup command${startupCommandCount === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      </div>
                      <div className="session-actions">
                        <Tooltip label={`Open preset ${preset.name}`} placement="top">
                          <button
                            type="button"
                            className="session-action-btn"
                            onClick={() => onWorkspaceTabLaunch(preset)}
                            aria-label={`Open preset ${preset.name}`}
                          >
                            <ArrowRightIcon size="sm" />
                          </button>
                        </Tooltip>

                        <Tooltip label={`Edit preset ${preset.name}`} placement="top">
                          <button
                            type="button"
                            className="session-action-btn"
                            onClick={() => editPreset(preset)}
                            aria-label={`Edit preset ${preset.name}`}
                          >
                            <PencilIcon size="sm" />
                          </button>
                        </Tooltip>

                        <Tooltip label={`Delete preset ${preset.name}`} placement="top">
                          <button
                            type="button"
                            className="session-action-btn danger"
                            onClick={() => setPresetPendingDeletion(preset)}
                            aria-label={`Delete preset ${preset.name}`}
                          >
                            <TrashIcon size="sm" />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      {tabMenu && createPortal(
        <div
          ref={tabMenuRef}
          className="vtab-context-menu"
          role="menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
        >
          <button role="menuitem" onClick={() => { startRename(tabMenu.tab); setTabMenu(null); }}>
            Rename tab
          </button>
          {tabMenu.tab.workspaceId && workspaceTabs.find((preset) => preset.id === tabMenu.tab.workspaceId) && (
            <button role="menuitem" onClick={() => { editPreset(workspaceTabs.find((preset) => preset.id === tabMenu.tab.workspaceId)!); setTabMenu(null); }}>
              Edit preset
            </button>
          )}
          <button role="menuitem" onClick={() => { onSaveWorkspaceTab(tabMenu.tab); setTabMenu(null); }}>
            {tabMenu.tab.workspaceId ? 'Update saved preset' : 'Save as preset'}
          </button>
        </div>,
        document.body,
      )}
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
              <h2 id="workspace-modal-title">{editingPreset ? 'Edit preset' : 'Create preset'}</h2>
              <Tooltip label="Close preset dialog" placement="left">
                <button onClick={closeWorkspaceForm} aria-label="Close preset dialog">
                  <XCloseIcon size="sm" />
                </button>
              </Tooltip>
            </div>
            <WorkspaceTabPresetForm
              sshProfiles={sshProfiles}
              preset={editingPreset ?? undefined}
              submitLabel={editingPreset ? 'Save changes' : 'Create preset'}
              onSubmit={savePreset}
            />
          </div>
        </div>,
        document.body,
      )}
      <ConfirmationDialog
        open={presetPendingDeletion !== null}
        title={presetPendingDeletion ? `Delete preset “${presetPendingDeletion.name}”?` : 'Delete preset?'}
        description="This permanently deletes the saved preset. Existing terminal tabs will stay open."
        confirmLabel="Delete preset"
        fallbackFocus={() => workspaceAddButtonRef.current}
        onConfirm={confirmDeletePreset}
        onCancel={() => setPresetPendingDeletion(null)}
      />
    </div>
  );
}
