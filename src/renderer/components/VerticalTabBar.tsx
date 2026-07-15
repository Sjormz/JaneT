import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TabInfo, SavedSSHProfile, WorkspaceTabPreset } from '../types';
import {
  TerminalTabIcon, LockIcon, XCloseIcon, PencilIcon, TrashIcon, CheckIcon,
  ChevronsLeftIcon, ListIcon, PlusIcon, ChevronRightIcon, ChevronDownIcon, PlugIcon,
} from '../icons';
import WorkspaceTabPresetForm, { sshProfileLabel } from './WorkspaceTabPresetForm';
import { useRefreshTask } from '../refreshCoordinator';
import { useModalFocus } from '../useModalFocus';

interface VerticalTabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  sshProfiles: SavedSSHProfile[];
  workspaceTabs: WorkspaceTabPreset[];
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onWorkspaceTabsChange: (presets: WorkspaceTabPreset[]) => void;
  onWorkspaceTabLaunch: (preset: WorkspaceTabPreset) => void;
  onSaveWorkspaceTab: (tab: TabInfo) => void;
  onRenameTab: (id: string, title: string) => void;
  onCollapse: () => void;
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

export default function VerticalTabBar({
  tabs,
  activeTabId,
  sshProfiles,
  workspaceTabs,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onWorkspaceTabsChange,
  onWorkspaceTabLaunch,
  onSaveWorkspaceTab,
  onRenameTab,
  onCollapse,
}: VerticalTabBarProps) {
  const [, setNow] = useState(Date.now());
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [workspacesExpanded, setWorkspacesExpanded] = useState(false);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [editingPreset, setEditingPreset] = useState<WorkspaceTabPreset | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [tabMenu, setTabMenu] = useState<{ tab: TabInfo; x: number; y: number } | null>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const workspaceModalRef = useRef<HTMLDivElement>(null);
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

  const deletePreset = (id: string) => {
    onWorkspaceTabsChange(workspaceTabs.filter((preset) => preset.id !== id));
  };

  const workspaceModalOpen = showWorkspaceForm || editingPreset !== null;
  useModalFocus({
    open: workspaceModalOpen,
    containerRef: workspaceModalRef,
    onClose: closeWorkspaceForm,
    initialFocusSelector: 'input',
  });

  return (
    <div className="vtab-bar" aria-label="Tab list">
      <div className="vtab-header">
        <div className="vtab-heading">
          <span className="vtab-title">Tabs</span>
          <span className="vtab-count">{tabs.length}</span>
        </div>
        <div className="vtab-header-actions">
          <button className="vtab-header-btn" onClick={onNewTab} title="New tab" aria-label="New tab">
            <PlusIcon size="sm" />
          </button>
          <button className="vtab-header-btn" onClick={onCollapse} title="Collapse tabs" aria-label="Collapse tabs">
            <ChevronsLeftIcon size="sm" />
          </button>
        </div>
      </div>

      <div className="vtab-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isSSH = tab.type === 'ssh';
          const TabIcon = isSSH ? LockIcon : TerminalTabIcon;
          const relTime = tabTimestamps[tab.id] ? formatRelativeTime(tabTimestamps[tab.id]) : 'now';
          const editing = editingTabId === tab.id;
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
                  <div className="vtab-name" title={tab.title}>{tab.title}</div>
                )}
                <div className="vtab-sub" title={subTitle}>
                  {subLabel}
                </div>
              </div>
              <div className="vtab-meta">
                <span className="vtab-time">{relTime}</span>
                {editing && (
                  <button
                    className="vtab-action"
                    onClick={(e) => { e.stopPropagation(); saveRename(); }}
                    title="Save tab name"
                    aria-label="Save tab name"
                  >
                    <CheckIcon size="xs" />
                  </button>
                )}
                <button
                  className="vtab-close"
                  onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                  title="Close tab"
                  aria-label="Close tab"
                >
                  <XCloseIcon size="xs" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="workspace-section">
        <button
          className="workspace-section-header"
          onClick={() => setWorkspacesExpanded((expanded) => !expanded)}
          title={workspacesExpanded ? 'Collapse workspaces' : 'Expand workspaces'}
          aria-expanded={workspacesExpanded}
          aria-label="Workspaces"
        >
          <span className="workspace-section-chevron">
            {workspacesExpanded ? <ChevronDownIcon size="xs" /> : <ChevronRightIcon size="xs" />}
          </span>
          <span className="workspace-section-title">
            <ListIcon size="xs" /> Workspaces
          </span>
          <span className="workspace-section-count">{workspaceTabs.length}</span>
        </button>

        {workspacesExpanded && (
          <div className="workspace-section-content">
            <button
              className="workspace-add-btn"
              onClick={openWorkspaceForm}
              title="Create a reusable workspace preset"
              aria-label="Create workspace preset"
            >
              <PlusIcon size="xs" /> New workspace preset
            </button>

            {workspaceTabs.length === 0 ? (
              <div className="workspace-empty">No workspace presets saved</div>
            ) : (
              <div className="workspace-list">
                {workspaceTabs.map((preset) => {
                  const sshProfile = sshProfiles.find((profile) => profile.id === preset.sshProfileId);
                  const subtitle = preset.type === 'ssh'
                    ? sshProfile ? sshProfileLabel(sshProfile) : 'Missing SSH profile'
                    : preset.cwd || 'Home directory';

                  return (
                    <div className="workspace-item" key={preset.id}>
                      <div className="workspace-item-main">
                        <TerminalTabIcon size="md" className="workspace-item-icon" />
                        <div className="workspace-item-text">
                          <span className="workspace-item-name">{preset.name}</span>
                          <span className="workspace-item-sub">
                            {preset.terminalCount} terminal{preset.terminalCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                      <div className="session-actions">
                        <button
                          type="button"
                          className="session-action-btn"
                          onClick={() => onWorkspaceTabLaunch(preset)}
                          title="Open workspace"
                          aria-label={`Open ${preset.name}`}
                        >
                          <PlugIcon size="sm" />
                        </button>

                        <button
                          type="button"
                          className="session-action-btn"
                          onClick={() => editPreset(preset)}
                          title="Edit workspace preset"
                          aria-label={`Edit ${preset.name}`}
                        >
                          <PencilIcon size="sm" />
                        </button>

                        <button
                          type="button"
                          className="session-action-btn danger"
                          onClick={() => deletePreset(preset.id)}
                          title="Delete workspace preset"
                          aria-label={`Delete ${preset.name}`}
                        >
                          <TrashIcon size="sm" />
                        </button>
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
              Edit workspace
            </button>
          )}
          <button role="menuitem" onClick={() => { onSaveWorkspaceTab(tabMenu.tab); setTabMenu(null); }}>
            Save as workspace
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
              <h2 id="workspace-modal-title">{editingPreset ? 'Edit Workspace Preset' : 'Create Workspace Preset'}</h2>
              <button onClick={closeWorkspaceForm} title="Close" aria-label="Close workspace preset dialog">
                <XCloseIcon size="sm" />
              </button>
            </div>
            <WorkspaceTabPresetForm
              sshProfiles={sshProfiles}
              preset={editingPreset ?? undefined}
              submitLabel={editingPreset ? 'Save Workspace Preset' : 'Add Workspace Preset'}
              onSubmit={savePreset}
            />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
