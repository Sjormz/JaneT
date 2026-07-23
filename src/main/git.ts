import * as path from 'path';
import * as fs from 'fs';
import { parseWorktreePorcelain, GitWorktreeInfo } from '../shared/gitWorktrees';

let simpleGit: any = null;
try {
  simpleGit = require('simple-git');
} catch {
  // simple-git is optional at runtime; IPC methods return null/false if absent.
}

export interface GitStatusResult {
  current: string;
  tracking: string;
  files: Array<{
    path: string;
    working_dir: string;
    index: string;
    staged: boolean;
    unstaged: boolean;
  }>;
  ahead: number;
  behind: number;
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: string[];
  conflicted: string[];
}

interface SimpleGitStatusLike {
  current?: string | null;
  tracking?: string | null;
  files?: Array<{ path: string; working_dir: string; index: string }>;
  staged?: string[];
  ahead?: number;
  behind?: number;
  created?: string[];
  deleted?: string[];
  modified?: string[];
  renamed?: string[];
  conflicted?: string[];
}

/** Convert simple-git's status shape into the stable renderer contract. */
export function normalizeGitStatus(status: SimpleGitStatusLike): GitStatusResult {
  const conflicted = [...(status.conflicted ?? [])];
  const conflictedPaths = new Set(conflicted);
  const explicitlyStaged = new Set(status.staged ?? []);
  const files = (status.files ?? []).map((file) => {
    const indexHasChange = Boolean(file.index && file.index !== ' ' && file.index !== '?' && file.index !== '!');
    return {
      path: file.path,
      working_dir: file.working_dir,
      index: file.index,
      // FileStatusSummary has no `staged` property. Conflicts use index codes
      // too, so keep them in their own state instead of calling them staged.
      staged: !conflictedPaths.has(file.path) && (explicitlyStaged.has(file.path) || indexHasChange),
      unstaged: !conflictedPaths.has(file.path) && Boolean(file.working_dir && file.working_dir !== ' '),
    };
  });

  return {
    current: status.current || 'HEAD',
    tracking: status.tracking || '',
    files,
    ahead: status.ahead ?? 0,
    behind: status.behind ?? 0,
    created: [...(status.created ?? [])],
    deleted: [...(status.deleted ?? [])],
    modified: [...(status.modified ?? [])],
    renamed: [...(status.renamed ?? [])],
    conflicted,
  };
}

export function buildAddWorktreeArgs(
  worktreePath: string,
  branch: string,
  createBranch = false,
  startPoint?: string,
): string[] {
  const cleanPath = worktreePath.trim();
  const cleanBranch = branch.trim();
  const cleanStartPoint = startPoint?.trim();
  if (createBranch) {
    return [
      'worktree', 'add', '-b', cleanBranch, cleanPath,
      ...(cleanStartPoint ? [cleanStartPoint] : []),
    ];
  }
  return ['worktree', 'add', cleanPath, cleanBranch];
}

interface GitBranchInfo {
  name: string;
  current: boolean;
  commit: string;
  label: string;
  worktreePath?: string;
  isRemote: boolean;
  remote?: string;
}

interface GitDetailsResult {
  branches: GitBranchInfo[];
  worktrees: GitWorktreeInfo[];
}

interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export class GitManager {
  async findRepo(startPath: string): Promise<string | null> {
    let current = path.resolve(startPath);
    const root = process.platform === 'win32' ? current.split(path.sep)[0] + '\\' : '/';

    while (true) {
      const gitDir = path.join(current, '.git');
      try {
        const stat = await fs.promises.stat(gitDir);
        if (stat.isDirectory() || stat.isFile()) return current;
      } catch {}

      if (current === root) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  async status(repoPath: string): Promise<GitStatusResult | null> {
    if (!simpleGit) return null;
    try {
      const status = await simpleGit(repoPath).status();
      return normalizeGitStatus(status);
    } catch {
      return null;
    }
  }

  async branches(repoPath: string): Promise<GitBranchInfo[] | null> {
    const details = await this.details(repoPath);
    return details?.branches ?? null;
  }

  async details(repoPath: string): Promise<GitDetailsResult | null> {
    if (!simpleGit) return null;
    try {
      const git = simpleGit(repoPath);
      const [result, worktrees] = await Promise.all([
        git.branch(),
        this.worktrees(repoPath).catch(() => [] as GitWorktreeInfo[]),
      ]);
      const worktreeByBranch = new Map(
        (worktrees ?? []).filter((tree) => tree.branch).map((tree) => [tree.branch!, tree.path]),
      );
      const branches = result.all.map((name: string) => {
        const isRemote = name.startsWith('remotes/');
        const cleanName = isRemote ? name.replace(/^remotes\//, '') : name;
        const remote = isRemote ? cleanName.split('/')[0] : undefined;
        return {
          name: cleanName,
          current: !isRemote && name === result.current,
          commit: result.branches[name]?.commit || '',
          label: result.branches[name]?.label || cleanName,
          worktreePath: worktreeByBranch.get(cleanName),
          isRemote,
          remote,
        };
      });
      return { branches, worktrees: worktrees ?? [] };
    } catch {
      return null;
    }
  }

  async log(repoPath: string, maxCount: number = 20): Promise<GitLogEntry[] | null> {
    if (!simpleGit) return null;
    try {
      const log = await simpleGit(repoPath).log({ maxCount });
      return log.all.map((entry: any) => ({
        hash: entry.hash,
        date: entry.date,
        message: entry.message,
        author_name: entry.author_name,
        author_email: entry.author_email,
      }));
    } catch {
      return null;
    }
  }

  async checkout(repoPath: string, branch: string): Promise<boolean> {
    return this.switchBranch(repoPath, branch);
  }

  async switchBranch(repoPath: string, branch: string): Promise<boolean> {
    if (!simpleGit || !branch.trim()) return false;
    try {
      await simpleGit(repoPath).raw(['switch', branch.trim()]);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(repoPath: string, branch: string, startPoint?: string, checkout = true): Promise<boolean> {
    if (!simpleGit || !branch.trim()) return false;
    try {
      const args = checkout ? ['switch', '-c', branch.trim()] : ['branch', branch.trim()];
      if (startPoint?.trim()) args.push(startPoint.trim());
      await simpleGit(repoPath).raw(args);
      return true;
    } catch {
      return false;
    }
  }

  async deleteBranch(repoPath: string, branch: string, force = false): Promise<boolean> {
    if (!simpleGit || !branch.trim()) return false;
    try {
      await simpleGit(repoPath).raw(['branch', force ? '-D' : '-d', branch.trim()]);
      return true;
    } catch {
      return false;
    }
  }

  async stage(repoPath: string, paths: string[]): Promise<boolean> {
    if (!simpleGit || !validGitPaths(paths)) return false;
    try {
      await simpleGit(repoPath).raw(paths.length === 0
        ? ['add', '-A']
        : ['--literal-pathspecs', 'add', '--', ...paths]);
      return true;
    } catch {
      return false;
    }
  }

  async unstage(repoPath: string, paths: string[]): Promise<boolean> {
    if (!simpleGit || !validGitPaths(paths)) return false;
    try {
      await simpleGit(repoPath).raw([
        ...(paths.length > 0 ? ['--literal-pathspecs'] : []),
        'reset', '--', ...paths,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async commit(repoPath: string, message: string): Promise<boolean> {
    if (typeof message !== 'string') return false;
    const cleanMessage = message.trim();
    if (!simpleGit || !cleanMessage || cleanMessage.length > 10_000 || cleanMessage.includes('\0')) return false;
    try {
      await simpleGit(repoPath).raw(['commit', '-m', cleanMessage]);
      return true;
    } catch {
      return false;
    }
  }

  async fetch(repoPath: string): Promise<boolean> {
    return this.run(repoPath, ['fetch', '--all', '--prune']);
  }

  async pull(repoPath: string): Promise<boolean> {
    return this.run(repoPath, ['pull', '--ff-only']);
  }

  async push(repoPath: string): Promise<boolean> {
    return this.run(repoPath, ['push']);
  }

  private async run(repoPath: string, args: string[]): Promise<boolean> {
    if (!simpleGit) return false;
    try {
      await simpleGit(repoPath).raw(args);
      return true;
    } catch {
      return false;
    }
  }

  async worktrees(repoPath: string): Promise<GitWorktreeInfo[] | null> {
    if (!simpleGit) return null;
    try {
      const raw = await simpleGit(repoPath).raw(['worktree', 'list', '--porcelain', '-z']);
      return parseWorktreePorcelain(raw);
    } catch {
      return null;
    }
  }

  async addWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch = false,
    startPoint?: string,
  ): Promise<boolean> {
    if (!simpleGit || !worktreePath.trim() || !branch.trim()) return false;
    try {
      const args = buildAddWorktreeArgs(worktreePath, branch, createBranch, startPoint);
      await simpleGit(repoPath).raw(args);
      return true;
    } catch {
      return false;
    }
  }

  async removeWorktree(repoPath: string, worktreePath: string, force = false): Promise<boolean> {
    if (!simpleGit || !worktreePath.trim()) return false;
    try {
      await simpleGit(repoPath).raw(['worktree', 'remove', ...(force ? ['-f'] : []), worktreePath.trim()]);
      return true;
    } catch {
      return false;
    }
  }

  async pruneWorktrees(repoPath: string): Promise<boolean> {
    if (!simpleGit) return false;
    try {
      await simpleGit(repoPath).raw(['worktree', 'prune']);
      return true;
    } catch {
      return false;
    }
  }
}

function validGitPaths(paths: string[]): boolean {
  return Array.isArray(paths)
    && paths.length <= 10_000
    && paths.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 32_768 && !entry.includes('\0'));
}
