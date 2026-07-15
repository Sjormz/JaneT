import React from 'react';
import FileExplorer from './FileExplorer';
import SSHManager from './SSHManager';
import GitTree from './GitTree';
import ThemeSwitcher from './ThemeSwitcher';
import { SavedSSHProfile, SessionInfo } from '../types';
import { ThemeName } from '../themes';
import { GitRepositoryState } from '../useGitRepository';

type SidebarSection = 'files' | 'ssh' | 'git' | 'settings';

interface SidebarProps {
  section: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  sshProfiles: SavedSSHProfile[];
  onSSHConnected: (session: SessionInfo) => void;
  onSSHProfilesChange: (profiles: SavedSSHProfile[]) => void;
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
  gitRepository: GitRepositoryState;
  onOpenLocalTabAt?: (cwd: string, title?: string) => void;
}

export default function Sidebar({
  section,
  sshProfiles,
  onSSHConnected,
  onSSHProfilesChange,
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
  gitRepository,
  onOpenLocalTabAt,
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
        {section === 'git' && (
          <GitTree
            cwdReady={cwdReady}
            isRemote={isRemote}
            repoPath={gitRepository.repoPath}
            status={gitRepository.status}
            searching={gitRepository.searching}
            onOpenLocalTabAt={onOpenLocalTabAt}
          />
        )}
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
            {shortcutEditor}
          </>
        )}
      </div>
    </div>
  );
}
