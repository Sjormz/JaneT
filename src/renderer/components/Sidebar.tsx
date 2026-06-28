import React from 'react';
import FileExplorer from './FileExplorer';
import SSHManager from './SSHManager';
import GitTree from './GitTree';
import ThemeSwitcher from './ThemeSwitcher';
import { SessionInfo } from '../types';
import { ThemeName } from '../themes';

type SidebarSection = 'files' | 'ssh' | 'git' | 'settings';

interface SidebarProps {
  section: SidebarSection;
  onSectionChange: (section: SidebarSection) => void;
  sshSessions: SessionInfo[];
  onSSHConnected: (session: SessionInfo) => void;
  onSSHDisconnected: (sessionId: string) => void;
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}

export default function Sidebar({
  section,
  onSectionChange,
  sshSessions,
  onSSHConnected,
  onSSHDisconnected,
  currentTheme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
}: SidebarProps) {
  const sections: Array<{ key: SidebarSection; label: string; icon: string }> = [
    { key: 'files', label: 'Files', icon: '📁' },
    { key: 'ssh', label: 'SSH', icon: '🔒' },
    { key: 'git', label: 'Git', icon: '⎇' },
    { key: 'settings', label: 'Settings', icon: '⚙' },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {sections.map((s) => (
          <button
            key={s.key}
            className={`sidebar-tab ${section === s.key ? 'active' : ''}`}
            onClick={() => onSectionChange(s.key)}
            title={s.label}
          >
            <span>{s.icon}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {section === 'files' && <FileExplorer />}
        {section === 'ssh' && (
          <SSHManager
            sshSessions={sshSessions}
            onConnected={onSSHConnected}
            onDisconnected={onSSHDisconnected}
          />
        )}
        {section === 'git' && <GitTree />}
        {section === 'settings' && (
          <ThemeSwitcher
            currentTheme={currentTheme}
            onThemeChange={onThemeChange}
            fontSize={fontSize}
            onFontSizeChange={onFontSizeChange}
          />
        )}
      </div>
    </div>
  );
}
