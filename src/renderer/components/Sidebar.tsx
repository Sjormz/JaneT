import React from 'react';
import FileExplorer from './FileExplorer';
import SSHManager from './SSHManager';
import GitTree from './GitTree';
import ThemeSwitcher from './ThemeSwitcher';
import WorkspaceTabsManager from './WorkspaceTabsManager';
import { SavedSSHProfile, SessionInfo, WorkspaceTabPreset } from '../types';
import { ThemeName } from '../themes';

type SidebarSection = 'files' | 'ssh' | 'git' | 'settings';

interface SidebarProps {
  section: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  sshProfiles: SavedSSHProfile[];
  workspaceTabs: WorkspaceTabPreset[];
  onSSHConnected: (session: SessionInfo) => void;
  onSSHProfilesChange: (profiles: SavedSSHProfile[]) => void;
  onWorkspaceTabsChange: (presets: WorkspaceTabPreset[]) => void;
  onWorkspaceTabLaunch: (preset: WorkspaceTabPreset) => void;
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  sidebarSide: 'left' | 'right';
  onSidebarSideChange: (side: 'left' | 'right') => void;
  shortcutEditor?: React.ReactNode;
  /** Current working directory of the focused terminal (or home if none). */
  cwd: string;
  /** True once we have a usable cwd to show. */
  cwdReady: boolean;
  /** True if the active tab is an SSH tab. Sidebar shows a notice. */
  isRemote: boolean;
  /** Shell integration copy-paste hints, shown in Settings. */
  shellIntegrationHint?: React.ReactNode;
}

export default function Sidebar({
  section,
  sshProfiles,
  workspaceTabs,
  onSSHConnected,
  onSSHProfilesChange,
  onWorkspaceTabsChange,
  onWorkspaceTabLaunch,
  currentTheme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  sidebarSide,
  onSidebarSideChange,
  shortcutEditor,
  cwd,
  cwdReady,
  isRemote,
  shellIntegrationHint,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-content">
        {section === 'files' && <FileExplorer cwd={cwd} cwdReady={cwdReady} isRemote={isRemote} />}
        {section === 'ssh' && (
          <SSHManager
            sshProfiles={sshProfiles}
            onConnected={onSSHConnected}
            onProfilesChange={onSSHProfilesChange}
          />
        )}
        {section === 'git' && <GitTree cwd={cwd} cwdReady={cwdReady} isRemote={isRemote} />}
        {section === 'settings' && (
          <>
            <ThemeSwitcher
              currentTheme={currentTheme}
              onThemeChange={onThemeChange}
              fontSize={fontSize}
              onFontSizeChange={onFontSizeChange}
              sidebarSide={sidebarSide}
              onSidebarSideChange={onSidebarSideChange}
            />
            <WorkspaceTabsManager
              presets={workspaceTabs}
              sshProfiles={sshProfiles}
              onChange={onWorkspaceTabsChange}
              onLaunch={onWorkspaceTabLaunch}
            />
            {shortcutEditor}
            {shellIntegrationHint}
          </>
        )}
      </div>
    </div>
  );
}
