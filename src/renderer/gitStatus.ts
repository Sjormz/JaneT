export interface GitStatusFile {
  path: string;
  staged: boolean;
}

export interface GitStatusResult {
  current: string;
  files: GitStatusFile[];
  ahead: number;
  behind: number;
  conflicted: string[];
}

export interface GitStatusSummary {
  repoPath: string;
  branch: string;
  ahead: number;
  behind: number;
  changed: number;
  staged: number;
  conflicted: number;
  /** Set when this summary is an older snapshot kept after Git failed; explains why. */
  staleReason?: string;
}

export function summarizeGitStatus(repoPath: string, status: GitStatusResult, staleReason?: string | null): GitStatusSummary {
  return {
    repoPath,
    branch: status.current || 'HEAD',
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    changed: status.files.length,
    staged: status.files.filter((file) => file.staged).length,
    conflicted: status.conflicted.length,
    ...(staleReason ? { staleReason } : {}),
  };
}

export function formatGitStatusTitle(status: GitStatusSummary): string {
  const parts = [status.repoPath, status.branch];
  if (status.ahead) parts.push(`ahead ${status.ahead}`);
  if (status.behind) parts.push(`behind ${status.behind}`);
  if (status.changed) parts.push(`${status.changed} changed`);
  if (status.staged) parts.push(`${status.staged} staged`);
  if (status.conflicted) parts.push(`${status.conflicted} conflicted`);
  if (status.staleReason) parts.push(`Out of date: ${status.staleReason}`);
  return parts.join(' · ');
}
