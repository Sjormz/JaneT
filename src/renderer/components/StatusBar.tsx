import React from "react";
import { SessionInfo } from "../types";
import { ArrowDownIcon, ArrowUpIcon, CircleDotIcon, CircleIcon, FolderIcon, SourceControlIcon } from "../icons";
import { formatGitStatusTitle, GitStatusSummary } from "../gitStatus";
import Tooltip from './Tooltip';

interface StatusBarProps {
  sshSessions: SessionInfo[];
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
  cwd,
  gitStatus,
  isRemote,
  remoteHost,
}: StatusBarProps) {
  return (
    <div className="status-bar">
      <div className="status-left">
        {sshSessions.length > 0 && (
          <span className="status-item">
            <CircleDotIcon size="xs" className="status-ssh-dot" />
            {sshSessions.length} SSH connection{sshSessions.length === 1 ? '' : 's'}
          </span>
        )}
        {isRemote && remoteHost ? (
          <Tooltip label={`Connected to ${remoteHost}; working directory unavailable`} placement="top">
            <span className="status-item status-cwd status-cwd-remote" aria-label={`SSH connection to ${remoteHost}; working directory unavailable`}>
              <FolderIcon size="xs" />
              <span>SSH · {remoteHost}</span>
            </span>
          </Tooltip>
        ) : cwd && (
          <Tooltip label={cwd} placement="top">
            <span className="status-item status-cwd" aria-label={`Working directory: ${cwd}`}>
              <FolderIcon size="xs" />
              <span className="status-cwd-local">{cwd}</span>
            </span>
          </Tooltip>
        )}
        {gitStatus && (
          <Tooltip label={formatGitStatusTitle(gitStatus)} placement="top">
            <span className="status-item status-git" aria-label={formatGitStatusTitle(gitStatus)}>
              <SourceControlIcon size="xs" />
              <span>{gitStatus.branch}</span>
              {gitStatus.changed > 0 && <span className="status-git-dirty"><CircleIcon size={6} /> {gitStatus.changed}</span>}
              {gitStatus.ahead > 0 && <span className="status-git-ahead"><ArrowUpIcon size="xs" />{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span className="status-git-behind"><ArrowDownIcon size="xs" />{gitStatus.behind}</span>}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
