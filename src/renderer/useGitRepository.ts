import { useEffect, useRef, useState } from 'react';
import { useRefreshTask } from './refreshCoordinator';

export interface GitStatusResult {
  current: string;
  files: Array<{ path: string; working_dir: string; index: string; staged: boolean; unstaged: boolean }>;
  ahead: number;
  behind: number;
  created: string[];
  modified: string[];
  deleted: string[];
  conflicted: string[];
}

export interface GitRepositoryState {
  repoPath: string | null;
  status: GitStatusResult | null;
  searching: boolean;
}

const REPO_DISCOVERY_INTERVAL_MS = 15_000;
const GIT_STATUS_INTERVAL_MS = 3_000;

/**
 * Owns the active repository/status snapshot shared by the status bar and
 * Source Control. Discovery is deliberately slower than status polling, while
 * prompt/focus invalidations handled by the coordinator refresh both at once.
 */
export function useGitRepository(cwd: string, enabled: boolean): GitRepositoryState {
  const active = enabled && Boolean(cwd);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [searching, setSearching] = useState(active);
  const resourceGeneration = useRef(0);
  const statusGeneration = useRef(0);
  const repoPathRef = useRef<string | null>(null);

  useEffect(() => {
    resourceGeneration.current += 1;
    statusGeneration.current += 1;
    repoPathRef.current = null;
    setRepoPath(null);
    setStatus(null);
    setSearching(active);
  }, [cwd, active]);

  useRefreshTask({
    key: `git-repository:${cwd || 'none'}`,
    intervalMs: REPO_DISCOVERY_INTERVAL_MS,
    enabled: active,
    run: async () => {
      const generation = resourceGeneration.current;
      let discovered: string | null;
      try {
        discovered = await window.janet.gitFindRepo({ startPath: cwd });
      } catch {
        if (generation === resourceGeneration.current) setSearching(false);
        return;
      }
      if (generation !== resourceGeneration.current) return;

      if (repoPathRef.current !== discovered) {
        repoPathRef.current = discovered;
        statusGeneration.current += 1;
        setRepoPath(discovered);
        setStatus(null);
      }
      setSearching(false);
    },
  });

  useRefreshTask({
    key: `git-status:${repoPath || 'none'}`,
    intervalMs: GIT_STATUS_INTERVAL_MS,
    enabled: active && Boolean(repoPath),
    run: async () => {
      if (!repoPath) return;
      const generation = ++statusGeneration.current;
      const requestedRepo = repoPath;
      try {
        const result = await window.janet.gitStatus({ repoPath: requestedRepo });
        if (
          generation === statusGeneration.current &&
          repoPathRef.current === requestedRepo &&
          result
        ) {
          setStatus((current) => gitStatusesEqual(current, result) ? current : result);
        }
      } catch {
        // Keep the last good snapshot. Repository discovery will clear it if
        // the cwd stops belonging to a repository.
      }
    },
  });

  return { repoPath, status, searching };
}

function gitStatusesEqual(left: GitStatusResult | null, right: GitStatusResult): boolean {
  if (!left ||
      left.current !== right.current ||
      left.ahead !== right.ahead ||
      left.behind !== right.behind ||
      !stringArraysEqual(left.created, right.created) ||
      !stringArraysEqual(left.modified, right.modified) ||
      !stringArraysEqual(left.deleted, right.deleted) ||
      !stringArraysEqual(left.conflicted, right.conflicted) ||
      left.files.length !== right.files.length) {
    return false;
  }

  return left.files.every((file, index) => {
    const candidate = right.files[index];
    return candidate !== undefined &&
      file.path === candidate.path &&
      file.working_dir === candidate.working_dir &&
      file.index === candidate.index &&
      file.staged === candidate.staged &&
      file.unstaged === candidate.unstaged;
  });
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
