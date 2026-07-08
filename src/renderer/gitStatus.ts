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
}

export function summarizeGitStatus(repoPath: string, status: GitStatusResult): GitStatusSummary {
  return {
    repoPath,
    branch: status.current || 'HEAD',
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    changed: status.files.length,
    staged: status.files.filter((file) => file.staged).length,
    conflicted: status.conflicted.length,
  };
}

export function formatGitStatusTitle(status: GitStatusSummary): string {
  const parts = [status.repoPath, status.branch];
  if (status.ahead) parts.push(`ahead ${status.ahead}`);
  if (status.behind) parts.push(`behind ${status.behind}`);
  if (status.changed) parts.push(`${status.changed} changed`);
  if (status.staged) parts.push(`${status.staged} staged`);
  if (status.conflicted) parts.push(`${status.conflicted} conflicted`);
  return parts.join(' · ');
}
