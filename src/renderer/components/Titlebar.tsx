import React, { useEffect, useState, useCallback } from 'react';
import {
  FilesIcon, SSHIcon, SourceControlIcon, SettingsIconCmp,
  MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon,
} from '../icons';
import BrandMark from './BrandMark';
import Tooltip from './Tooltip';
import { formatShortcutForDisplay } from '../keybindings';

export type SidebarSection = 'files' | 'ssh' | 'git' | 'settings';

interface NavItem {
  key: SidebarSection;
  Icon: React.FC<any>;
  name: string;
  shortcut?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'files',    Icon: FilesIcon,           name: 'Explorer' },
  { key: 'ssh',      Icon: SSHIcon,             name: 'SSH connections' },
  { key: 'git',      Icon: SourceControlIcon,   name: 'Source Control' },
  { key: 'settings', Icon: SettingsIconCmp,     name: 'Settings' },
];

function initialPlatform() {
  if (/Mac|iPhone|iPad/i.test(navigator.platform)) return 'darwin';
  if (/Win/i.test(navigator.platform)) return 'win32';
  return 'linux';
}

interface TitlebarProps {
  // sidebar nav
  section: SidebarSection;
  onSectionChange: (s: SidebarSection) => void;
  sidebarOpen: boolean;
  // palette
  onOpenPalette: () => void;
  paletteShortcut: string;
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
  onOpenPalette,
  paletteShortcut,
}: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);
  const [platform, setPlatform] = useState(initialPlatform);
  const displayedPaletteShortcut = formatShortcutForDisplay(paletteShortcut, platform);

  const refreshMaximized = useCallback(async () => {
    try { setMaximized(await window.janet.windowIsMaximized()); } catch {}
  }, []);

  useEffect(() => { refreshMaximized(); }, [refreshMaximized]);

  useEffect(() => {
    window.janet.getPlatform().then(setPlatform).catch(() => {});
  }, []);

  // Track maximize state changes
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
    <div className={`titlebar ${platform === 'darwin' ? 'is-mac' : ''}`} role="banner">
      {/* Brand */}
      <div className="titlebar-brand">
        <BrandMark size={28} className="titlebar-logo" />
        <span className="titlebar-app-name">JaneT</span>
      </div>

      {/* Section nav (was ActivityBar) */}
      <nav className="titlebar-nav" aria-label="Sidebar section">
        {NAV_ITEMS.map(({ key, Icon, name }) => {
          const active = sidebarOpen && section === key;
          const label = `${active ? 'Hide' : 'Open'} ${name}`;
          return (
            <Tooltip key={key} label={label} placement="bottom">
              <button
                className={`titlebar-nav-btn ${active ? 'active' : ''}`}
                onClick={() => onSectionChange(key)}
                aria-label={label}
                aria-pressed={active}
              >
                <Icon size="md" />
              </button>
            </Tooltip>
          );
        })}
      </nav>

      {/* Right cluster: palette + window controls */}
      <div className="titlebar-right">
        <Tooltip label="Open command palette" shortcut={displayedPaletteShortcut} placement="bottom">
          <button
            className="titlebar-palette-btn"
            onClick={onOpenPalette}
            aria-label={`Open command palette (${displayedPaletteShortcut})`}
          >
            <span className="titlebar-palette-label">Search commands</span>
            <kbd className="titlebar-kbd" aria-hidden="true">{displayedPaletteShortcut}</kbd>
          </button>
        </Tooltip>

        {platform !== 'darwin' && (
          <div className="titlebar-controls">
            <Tooltip label="Minimize window" placement="bottom">
              <button className="titlebar-control-btn" onClick={() => window.janet.windowMinimize()} aria-label="Minimize window">
                <MinimizeIcon size="md" />
              </button>
            </Tooltip>
            <Tooltip label={maximized ? 'Restore window' : 'Maximize window'} placement="bottom">
              <button
                className="titlebar-control-btn"
                onClick={() => { window.janet.windowMaximize().then(refreshMaximized); }}
                aria-label={maximized ? 'Restore window' : 'Maximize window'}
              >
                {maximized ? <RestoreIcon size="md" /> : <MaximizeIcon size="md" />}
              </button>
            </Tooltip>
            <Tooltip label="Close window" placement="bottom">
              <button className="titlebar-control-btn close" onClick={() => window.janet.windowClose()} aria-label="Close window">
                <CloseIcon size="md" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
