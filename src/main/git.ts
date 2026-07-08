import * as path from 'path';
import * as fs from 'fs';
import { parseWorktreePorcelain, GitWorktreeInfo } from '../shared/gitWorktrees';

let simpleGit: any = null;
try {
  simpleGit = require('simple-git');
} catch {
  // simple-git is optional at runtime; IPC methods return null/false if absent.
}

interface GitStatusResult {
  current: string;
  tracking: string;
  files: Array<{
    path: string;
    working_dir: string;
    index: string;
    staged: boolean;
  }>;
  ahead: number;
  behind: number;
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: string[];
  conflicted: string[];
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
        const stat = fs.statSync(gitDir);
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
      return {
        current: status.current,
        tracking: status.tracking || '',
        files: status.files.map((f: any) => ({
          path: f.path,
          working_dir: f.working_dir,
          index: f.index,
          staged: f.staged,
        })),
        ahead: status.ahead,
        behind: status.behind,
        created: status.created,
        deleted: status.deleted,
        modified: status.modified,
        renamed: status.renamed,
        conflicted: status.conflicted,
      };
    } catch {
      return null;
    }
  }

  async branches(repoPath: string): Promise<GitBranchInfo[] | null> {
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
      return result.all.map((name: string) => {
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
      const args = ['worktree', 'add'];
      if (createBranch) args.push('-b', branch.trim());
      args.push(worktreePath.trim(), createBranch && startPoint?.trim() ? startPoint.trim() : branch.trim());
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
