import React, { useState, useEffect } from 'react';
import { TabInfo } from '../types';
import { TerminalTabIcon, LockIcon, XCloseIcon, PlusIcon, PencilIcon, CheckIcon, ChevronsLeftIcon } from '../icons';

interface VerticalTabBarProps {
  tabs: TabInfo[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
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

export default function VerticalTabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onRenameTab,
  onCollapse,
}: VerticalTabBarProps) {
  const [, setNow] = useState(Date.now());
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
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
                <div className="vtab-sub">
                  {isSSH ? `SSH · ${tab.sshSessionId?.slice(0, 6) ?? ''}` : tab.cwd || 'local · pwsh'}
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
                {tabs.length > 1 && (
                  <button
                    className="vtab-close"
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                    title="Close tab"
                    aria-label="Close tab"
                  >
                    <XCloseIcon size="xs" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
