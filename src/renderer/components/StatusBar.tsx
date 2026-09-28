import React, { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CircleIcon, FolderIcon, SourceControlIcon } from "../icons";
import { formatGitStatusTitle, GitStatusSummary } from "../gitStatus";
import Tooltip from './Tooltip';

interface StatusBarProps {
  /** The cwd of the focused terminal. */
  cwd: string;
  gitStatus?: GitStatusSummary | null;
  /** Used to show the path as ~/… ; the full path stays in the tooltip and accessible name. */
  homeDir?: string;
}

export function abbreviateHome(path: string, homeDir?: string): string {
  if (!homeDir) return path;
  const home = homeDir.replace(/[\\/]+$/, '');
  if (path === home) return '~';
  return path.startsWith(`${home}/`) || path.startsWith(`${home}\\`) ? `~${path.slice(home.length)}` : path;
}

export default function StatusBar({
  cwd,
  gitStatus,
  homeDir,
}: StatusBarProps) {
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.janet.getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <footer className="status-bar app-status" aria-label="Workspace status">
      <div className="status-left">
        {cwd && (
          <Tooltip label={cwd} placement="top">
            <span className="status-item status-cwd" aria-label={`Working directory: ${cwd}`}>
              <FolderIcon size="xs" />
              <span className="status-cwd-local">{abbreviateHome(cwd, homeDir)}</span>
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
            <span>v{version}</span>
          </button>
        </Tooltip>
      )}
    </footer>
  );
}
