import React, { useEffect, useState, useCallback } from 'react';
import {
  FilesIcon, SSHIcon, SourceControlIcon, SettingsIconCmp,
  MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon,
  CommandIcon, PlusIcon,
} from '../icons';

export type SidebarSection = 'files' | 'ssh' | 'git' | 'settings';

interface NavItem {
  key: SidebarSection;
  Icon: React.FC<any>;
  label: string;
  shortcut?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'files',    Icon: FilesIcon,           label: 'Explorer' },
  { key: 'ssh',      Icon: SSHIcon,             label: 'SSH' },
  { key: 'git',      Icon: SourceControlIcon,   label: 'Source Control' },
  { key: 'settings', Icon: SettingsIconCmp,     label: 'Settings' },
];

interface TitlebarProps {
  // sidebar nav
  section: SidebarSection;
  onSectionChange: (s: SidebarSection) => void;
  sidebarOpen: boolean;
  onNewTab: () => void;
  // palette
  onOpenPalette: () => void;
}

/**
 * Top-of-window chrome: app brand, section nav (left), new-tab button,
 * palette hint, and window controls (right). The whole bar is a drag region
 * except for the interactive buttons.
 */
export default function Titlebar({
  section,
  onSectionChange,
  sidebarOpen,
  onNewTab,
  onOpenPalette,
}: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);

  const refreshMaximized = useCallback(async () => {
    try { setMaximized(await window.janet.windowIsMaximized()); } catch {}
  }, []);

  useEffect(() => { refreshMaximized(); }, [refreshMaximized]);

  // Track maximize state changes (window resize on Windows doesn't always
  // tell us directly, so poll on focus / resize).
  useEffect(() => {
    const onResize = () => refreshMaximized();
    window.addEventListener('resize', onResize);
    window.addEventListener('focus', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('focus', onResize);
    };
  }, [refreshMaximized]);

  return (
    <div className="titlebar" role="banner">
      {/* Brand */}
      <div className="titlebar-brand">
        <div className="titlebar-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <span className="titlebar-app-name">JaneT</span>
      </div>

      {/* Section nav (was ActivityBar) */}
      <nav className="titlebar-nav" aria-label="Sidebar section">
        {NAV_ITEMS.map(({ key, Icon, label }) => {
          const active = sidebarOpen && section === key;
          return (
            <button
              key={key}
              className={`titlebar-nav-btn ${active ? 'active' : ''}`}
              onClick={() => onSectionChange(key)}
              title={label}
              aria-label={label}
              aria-pressed={active}
            >
              <Icon size="md" />
            </button>
          );
        })}
      </nav>

      {/* Right cluster: palette + window controls */}
      <div className="titlebar-right">
        <button
          className="titlebar-tab-new"
          onClick={onNewTab}
          title="New terminal"
          aria-label="New terminal"
        >
          <PlusIcon size="sm" />
        </button>

        <button
          className="titlebar-palette-btn"
          onClick={onOpenPalette}
          title="Command palette (Ctrl+Shift+P)"
        >
          <span className="titlebar-palette-label">Search</span>
          <kbd className="titlebar-kbd">
            <CommandIcon size="xs" />
            <span>K</span>
          </kbd>
        </button>

        <div className="titlebar-controls">
          <button
            className="titlebar-control-btn"
            onClick={() => window.janet.windowMinimize()}
            title="Minimize"
            aria-label="Minimize"
          >
            <MinimizeIcon size="md" />
          </button>
          <button
            className="titlebar-control-btn"
            onClick={() => { window.janet.windowMaximize().then(refreshMaximized); }}
            title={maximized ? 'Restore' : 'Maximize'}
            aria-label={maximized ? 'Restore' : 'Maximize'}
          >
            {maximized ? <RestoreIcon size="md" /> : <MaximizeIcon size="md" />}
          </button>
          <button
            className="titlebar-control-btn close"
            onClick={() => window.janet.windowClose()}
            title="Close"
            aria-label="Close"
          >
            <CloseIcon size="md" />
          </button>
        </div>
      </div>
    </div>
  );
}
