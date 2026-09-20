import React, { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CircleIcon, FolderIcon, SourceControlIcon } from "../icons";
import { formatGitStatusTitle, GitStatusSummary } from "../gitStatus";
import Tooltip from './Tooltip';

interface StatusBarProps {
  /** The cwd of the focused terminal. */
  cwd: string;
  gitStatus?: GitStatusSummary | null;
}

export default function StatusBar({
  cwd,
  gitStatus,
}: StatusBarProps) {
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.janet.getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <footer className="status-bar app-status" aria-label="Workspace status">
      <span className="status-context">
        <span className="status-context-mark" aria-hidden="true" />
        LOCAL
      </span>
      <div className="status-left">
        {cwd && (
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
              <span className="status-git-branch">{gitStatus.branch}</span>
              {gitStatus.changed > 0 && <span className="status-git-dirty"><CircleIcon size={6} /> {gitStatus.changed}</span>}
              {gitStatus.ahead > 0 && <span className="status-git-ahead"><ArrowUpIcon size="xs" />{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span className="status-git-behind"><ArrowDownIcon size="xs" />{gitStatus.behind}</span>}
            </span>
          </Tooltip>
        )}
      </div>
      {version && (
        <Tooltip label="Check for updates" placement="top">
          <button
            type="button"
            className="status-version"
            aria-label={`JaneT version ${version}. Check for updates`}
            onClick={() => { window.janet.checkForUpdates().catch(() => {}); }}
          >
            <span className="status-build-label" aria-hidden="true">BUILD</span>
            <span>v{version}</span>
          </button>
        </Tooltip>
      )}
    </footer>
  );
}
