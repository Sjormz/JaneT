import React, { useState, useEffect } from 'react';
import { TabInfo, SavedSSHProfile, WorkspaceTabPreset } from '../types';
import {
  TerminalTabIcon, LockIcon, XCloseIcon, PencilIcon, TrashIcon, CheckIcon,
  ChevronsLeftIcon, ListIcon, PlusIcon, ChevronRightIcon, ChevronDownIcon, PlugIcon,
} from '../icons';
import WorkspaceTabPresetForm, { sshProfileLabel } from './WorkspaceTabPresetForm';

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
  onRenameTab,
  onCollapse,
}: VerticalTabBarProps) {
  const [, setNow] = useState(Date.now());
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [workspacesExpanded, setWorkspacesExpanded] = useState(false);
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false);
  const [editingPreset, setEditingPreset] = useState<WorkspaceTabPreset | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [tabTimestamps, setTabTimestamps] = useState<Record<string, Date>>(() => {
    const map: Record<string, Date> = {};
    for (const tab of tabs) map[tab.id] = new Date();
    return map;
  });

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setTabTimestamps((prev) => {
      const next = { ...prev };
      for (const tab of tabs) if (!next[tab.id]) next[tab.id] = new Date();
      return next;
    });
  }, [tabs]);

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
    closeWorkspaceForm();
    closePresetEditor();
  };

  const deletePreset = (id: string) => {
    onWorkspaceTabsChange(workspaceTabs.filter((preset) => preset.id !== id));
  };

  const formOpen = showWorkspaceForm || editingPreset !== null;

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
                {editing ? (
                  <button
                    className="vtab-action"
                    onClick={(e) => { e.stopPropagation(); saveRename(); }}
                    title="Save tab name"
                    aria-label="Save tab name"
                  >
                    <CheckIcon size="xs" />
                  </button>
                ) : (
                  <button
                    className="vtab-action"
                    onClick={(e) => { e.stopPropagation(); startRename(tab); }}
                    title="Rename tab"
                    aria-label="Rename tab"
                  >
                    <PencilIcon size="xs" />
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
            {formOpen && (
              <div className="workspace-form-block">
                <WorkspaceTabPresetForm
                  sshProfiles={sshProfiles}
                  preset={editingPreset ?? undefined}
                  submitLabel={editingPreset ? 'Save Workspace Preset' : 'Add Workspace Preset'}
                  onSubmit={savePreset}
                />
                <button
                  className="workspace-form-close"
                  onClick={editingPreset ? closePresetEditor : closeWorkspaceForm}
                  title="Close form"
                  aria-label="Close form"
                >
                  <XCloseIcon size="xs" /> Close
                </button>
              </div>
            )}

            {!formOpen && (
              <button
                className="workspace-add-btn"
                onClick={openWorkspaceForm}
                title="Save current workspace as preset"
                aria-label="Save workspace preset"
              >
                <PlusIcon size="xs" /> Save workspace preset
              </button>
            )}

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
                            {subtitle} · {preset.terminalCount} {preset.splitDirection === 'vertical' ? 'vertical' : 'horizontal'}
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
    </div>
  );
}
