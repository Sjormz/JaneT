import React from "react";
import { SessionInfo } from "../types";
import { CircleDotIcon, TerminalTabIcon, FolderIcon, SourceControlIcon } from "../icons";
import { formatGitStatusTitle, GitStatusSummary } from "../gitStatus";
import packageJson from "../../../package.json";

interface StatusBarProps {
  sshSessions: SessionInfo[];
  activeTerminalsCount: number;
  /** The cwd of the focused terminal. */
  cwd: string;
  gitStatus?: GitStatusSummary | null;
  /** True if the active tab is an SSH tab. */
  isRemote?: boolean;
  /** SSH host, if applicable — used in the status display. */
  remoteHost?: string;
}

export default function StatusBar({
  sshSessions,
  activeTerminalsCount,
  cwd,
  gitStatus,
  isRemote,
  remoteHost,
}: StatusBarProps) {
  return (
    <div className="status-bar">
      <div className="status-left">
        <span className="status-item">
          <TerminalTabIcon size="xs" /> v{packageJson.version}
        </span>
        {sshSessions.length > 0 && (
          <span className="status-item">
            <CircleDotIcon size="xs" className="status-ssh-dot" />
            {sshSessions.length} SSH
          </span>
        )}
        {isRemote && remoteHost ? (
          <span
            className="status-item status-cwd status-cwd-remote"
            title={`Connected to ${remoteHost}; remote working directory unavailable`}
          >
            <FolderIcon size="xs" />
            <span>{remoteHost} · remote cwd unavailable</span>
          </span>
        ) : cwd && (
          <span className="status-item status-cwd" title={cwd}>
            <FolderIcon size="xs" />
            <span className="status-cwd-local">{cwd}</span>
          </span>
        )}
        {gitStatus && (
          <span className="status-item status-git" title={formatGitStatusTitle(gitStatus)}>
            <SourceControlIcon size="xs" />
            <span>{gitStatus.branch}</span>
            {gitStatus.changed > 0 && <span className="status-git-dirty">● {gitStatus.changed}</span>}
            {gitStatus.ahead > 0 && <span className="status-git-ahead">↑{gitStatus.ahead}</span>}
            {gitStatus.behind > 0 && <span className="status-git-behind">↓{gitStatus.behind}</span>}
          </span>
        )}
      </div>
      <div className="status-right">
        <span className="status-item">
          {activeTerminalsCount} terminal{activeTerminalsCount !== 1 ? "s" : ""}
        </span>
        <span className="status-item platform">{navigator.platform}</span>
      </div>
    </div>
  );
}
