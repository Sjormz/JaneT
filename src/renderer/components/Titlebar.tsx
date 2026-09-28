import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  SettingsIconCmp, SearchIcon,
  MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon, SidebarIcon,
} from '../icons';
import BrandMark from './BrandMark';
import Tooltip from './Tooltip';
import MotionPresence from './MotionPresence';
import { formatShortcutForDisplay, shortcutKeycaps } from '../keybindings';

function initialPlatform() {
  if (/Mac|iPhone|iPad/i.test(navigator.platform)) return 'darwin';
  if (/Win/i.test(navigator.platform)) return 'win32';
  return 'linux';
}

interface TitlebarProps {
  // settings
  settingsOpen: boolean;
  onSettingsToggle: () => void;
  onSettingsClose: () => void;
  settingsContent: React.ReactNode;
  // palette
  onOpenPalette: () => void;
  paletteShortcut: string;
  /** Shown only while the workspaces rail is collapsed, as the way back to it. */
  tabsHidden?: boolean;
  onShowTabs?: () => void;
}

/**
 * Top-of-window chrome: app brand, palette hint, settings, and window controls.
 * The whole bar is a drag region except for the interactive buttons and
 * settings popover.
 */
export default function Titlebar({
  settingsOpen,
  onSettingsToggle,
  onSettingsClose,
  settingsContent,
  onOpenPalette,
  paletteShortcut,
  tabsHidden = false,
  onShowTabs,
}: TitlebarProps) {
  const [maximized, setMaximized] = useState(false);
  const [platform, setPlatform] = useState(initialPlatform);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPopoverRef = useRef<HTMLDivElement>(null);
  const previouslyOpenRef = useRef(settingsOpen);
  const restoreSettingsButtonRef = useRef(false);
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

  useEffect(() => {
    if (!settingsOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // A modal launched from Settings owns Escape until it is dismissed.
      if (document.querySelector('[aria-modal="true"]:not([inert] *)')) return;
      event.preventDefault();
      event.stopPropagation();
      restoreSettingsButtonRef.current = true;
      onSettingsClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Portaled modal content may still belong to the Settings surface.
      if (document.querySelector('[aria-modal="true"]:not([inert] *)')) return;
      if (
        settingsButtonRef.current?.contains(target)
        || settingsPopoverRef.current?.contains(target)
      ) return;
      restoreSettingsButtonRef.current = false;
      onSettingsClose();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onSettingsClose, settingsOpen]);

  useEffect(() => {
    if (previouslyOpenRef.current && !settingsOpen && restoreSettingsButtonRef.current) {
      requestAnimationFrame(() => settingsButtonRef.current?.focus());
    }
    if (!settingsOpen) restoreSettingsButtonRef.current = false;
    previouslyOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  return (
    <div className={`titlebar app-chrome ${platform === 'darwin' ? 'is-mac' : ''}`} role="banner">
      {/* Brand */}
      <div className="titlebar-leading">
        <div className="titlebar-brand">
          <BrandMark size={18} className="titlebar-logo" />
          <span className="titlebar-app-name">JaneT</span>
        </div>
        {tabsHidden && onShowTabs && (
          <Tooltip label="Show terminal tabs" placement="bottom">
            <button type="button" className="titlebar-icon-btn titlebar-rail-toggle" onClick={onShowTabs} aria-label="Show terminal tabs">
              <SidebarIcon size="sm" />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="titlebar-command">
        <Tooltip label="Open command palette" shortcut={displayedPaletteShortcut} placement="bottom">
          <button
            className="titlebar-palette-btn"
            onClick={onOpenPalette}
            aria-label={`Open command palette (${displayedPaletteShortcut})`}
          >
            <SearchIcon size="sm" />
            <span className="titlebar-palette-label">Search commands</span>
            <span className="titlebar-keys keycaps" aria-hidden="true">
              {shortcutKeycaps(paletteShortcut, platform).map((key, index) => <kbd key={`${key}-${index}`} className="keycap">{key}</kbd>)}
            </span>
          </button>
        </Tooltip>
      </div>

      <div className="titlebar-right">
        <div className="titlebar-settings">
          <Tooltip label={settingsOpen ? 'Hide settings' : 'Open settings'} placement="bottom">
            <button
              ref={settingsButtonRef}
              className={`titlebar-icon-btn titlebar-settings-btn ${settingsOpen ? 'active' : ''}`}
              onClick={(event) => {
                restoreSettingsButtonRef.current = settingsOpen && event.detail === 0;
                onSettingsToggle();
              }}
              aria-label={settingsOpen ? 'Hide settings' : 'Open settings'}
              aria-expanded={settingsOpen}
              aria-controls="titlebar-settings-popover"
              aria-haspopup="dialog"
            >
              <SettingsIconCmp size="md" />
            </button>
          </Tooltip>
          <MotionPresence>{settingsOpen && (
            <div
              ref={settingsPopoverRef}
              id="titlebar-settings-popover"
              className="titlebar-settings-popover"
              role="dialog"
              aria-label="Settings"
              data-keybindings-suspended
            >
              {settingsContent}
            </div>
          )}</MotionPresence>
        </div>

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
