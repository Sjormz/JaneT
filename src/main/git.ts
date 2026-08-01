import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { parseWorktreePorcelain, GitWorktreeInfo } from '../shared/gitWorktrees';
import { decodeTextFile } from './textFileCodec';
import { MAX_TEXT_FILE_BYTES, textFileFailure, type TextFileResult } from '../shared/textFiles';
import type { GitDiffResult, GitDiffSide } from '../shared/gitDiff';

let simpleGit: any = null;
try {
  simpleGit = require('simple-git');
} catch {
  // simple-git is optional at runtime; IPC methods return null/false if absent.
}

const MAX_GIT_LOG_ENTRIES = 1_000;
const GIT_DIFF_READ_BUFFER_BYTES = MAX_TEXT_FILE_BYTES + 1;

export interface GitStatusResult {
  current: string;
  tracking: string;
  files: Array<{
    path: string;
    originalPath?: string;
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
  files?: Array<{ path: string; from?: string; working_dir: string; index: string }>;
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
      ...(file.from ? { originalPath: file.from } : {}),
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

const CONFLICTED_GIT_STATES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Parse Git's stable, NUL-delimited machine format without changing filenames. */
export function parseGitStatusPorcelain(raw: string): GitStatusResult {
  const result: GitStatusResult = {
    current: 'HEAD',
    tracking: '',
    files: [],
    ahead: 0,
    behind: 0,
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    conflicted: [],
  };
  const records = raw.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith('## ')) {
      parseGitBranchHeader(record.slice(3), result);
      continue;
    }
    if (record.length < 4 || record[2] !== ' ') continue;

    const indexStatus = record[0];
    const workingStatus = record[1];
    const state = `${indexStatus}${workingStatus}`;
    const filePath = record.slice(3);
    const renamed = indexStatus === 'R' || indexStatus === 'C' || workingStatus === 'R' || workingStatus === 'C';
    const originalPath = renamed ? records[index += 1] : undefined;
    const conflicted = CONFLICTED_GIT_STATES.has(state);
    result.files.push({
      path: filePath,
      ...(originalPath ? { originalPath } : {}),
      working_dir: workingStatus,
      index: indexStatus,
      staged: !conflicted && indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!',
      unstaged: !conflicted && workingStatus !== ' ' && workingStatus !== '!',
    });
    if (conflicted) {
      result.conflicted.push(filePath);
    } else {
      if (indexStatus === 'A' || workingStatus === 'A') result.created.push(filePath);
      if (indexStatus === 'D' || workingStatus === 'D') result.deleted.push(filePath);
      if (indexStatus === 'M' || workingStatus === 'M' || indexStatus === 'T' || workingStatus === 'T') {
        result.modified.push(filePath);
      }
    }
    if (renamed) result.renamed.push(filePath);
  }
  return result;
}

function parseGitBranchHeader(header: string, result: GitStatusResult): void {
  const unborn = /^(?:No commits yet|Initial commit) on (.+)$/.exec(header);
  if (unborn) {
    result.current = unborn[1];
    return;
  }
  const trackingState = / \[([^\]]+)\]$/.exec(header);
  if (trackingState) {
    result.ahead = Number(/(?:^|, )ahead (\d+)/.exec(trackingState[1])?.[1] ?? 0);
    result.behind = Number(/(?:^|, )behind (\d+)/.exec(trackingState[1])?.[1] ?? 0);
    header = header.slice(0, trackingState.index);
  }
  const trackingSeparator = header.indexOf('...');
  if (trackingSeparator >= 0) {
    result.current = header.slice(0, trackingSeparator) || 'HEAD';
    result.tracking = header.slice(trackingSeparator + 3);
  } else if (!header.startsWith('HEAD ')) {
    result.current = header;
  }
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
      const status = await simpleGit(repoPath).raw([
        '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all',
      ]);
      return parseGitStatusPorcelain(status);
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
    if (!simpleGit || !Number.isInteger(maxCount) || maxCount < 1 || maxCount > MAX_GIT_LOG_ENTRIES) return null;
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

  async discard(repoPath: string, paths: string[]): Promise<boolean> {
    if (!simpleGit || !validGitPaths(paths) || paths.length === 0) return false;
    try {
      await simpleGit(repoPath).raw(['--literal-pathspecs', 'restore', '--worktree', '--', ...paths]);
      return true;
    } catch {
      return false;
    }
  }

  async diff(repoPath: string, filePath: string, side: GitDiffSide, originalPath?: string): Promise<GitDiffResult> {
    if (
      !simpleGit
      || typeof repoPath !== 'string'
      || !path.isAbsolute(repoPath)
      || !validGitPath(filePath)
      || (side !== 'staged' && side !== 'unstaged')
      || (originalPath !== undefined && (side !== 'staged' || !validGitPath(originalPath)))
    ) {
      return textFileFailure('INVALID_REQUEST', 'A repository, relative file path, and diff side are required.');
    }

    const repository = await resolveGitRepository(repoPath);
    if (!repository.ok) return repository;

    const original = side === 'staged'
      ? await readGitBlob(repository.value, `HEAD:${originalPath ?? filePath}`)
      : await readGitBlob(repository.value, `:${filePath}`);
    const modified = side === 'staged'
      ? await readGitBlob(repository.value, `:${filePath}`)
      : await readWorkingTreeFile(repository.value, filePath);
    if (!original.ok) return original;
    if (!modified.ok) return modified;
    return {
      ok: true,
      value: {
        repoPath,
        filePath,
        side,
        ...(originalPath ? { originalPath } : {}),
        originalContent: original.value,
        modifiedContent: modified.value,
      },
    };
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

function validGitPath(filePath: unknown): filePath is string {
  return typeof filePath === 'string'
    && filePath.length > 0
    && filePath.length <= 32_768
    && !filePath.includes('\0')
    && !path.isAbsolute(filePath)
    && !filePath.split(/[\\/]/).includes('..');
}

async function readGitBlob(repoPath: string, object: string): Promise<TextFileResult<string>> {
  const exists = await gitObjectExists(repoPath, object);
  if (!exists.ok) return exists;
  if (!exists.value) return { ok: true, value: '' };
  return new Promise((resolve) => {
    execFile(
      'git', ['show', '--no-textconv', object],
      { cwd: repoPath, encoding: 'buffer', maxBuffer: MAX_TEXT_FILE_BYTES + 1, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? textFileFailure('TOO_LARGE', 'This diff side is larger than JaneT\'s 2 MiB editor limit.')
            : textFileFailure('IO', 'This Git snapshot could not be read.'));
          return;
        }
        resolve(decodeSnapshot(Buffer.from(stdout)));
      },
    );
  });
}

async function resolveGitRepository(repoPath: string): Promise<TextFileResult<string>> {
  try {
    const resolved = await fs.promises.realpath(repoPath);
    const gitEntry = await fs.promises.stat(path.join(resolved, '.git'));
    return gitEntry.isDirectory() || gitEntry.isFile()
      ? { ok: true, value: resolved }
      : textFileFailure('IO', 'The repository is no longer available.');
  } catch {
    return textFileFailure('IO', 'The repository is no longer available.');
  }
}

async function gitObjectExists(repoPath: string, object: string): Promise<TextFileResult<boolean>> {
  return new Promise((resolve) => {
    execFile(
      'git', ['rev-parse', '--verify', '--quiet', object],
      { cwd: repoPath, encoding: 'buffer', maxBuffer: 1_024, windowsHide: true },
      (error) => {
        if (!error) {
          resolve({ ok: true, value: true });
          return;
        }
        resolve(error.code === 1
          ? { ok: true, value: false }
          : textFileFailure('IO', 'Git could not inspect this snapshot.'));
      },
    );
  });
}

async function readWorkingTreeFile(repoPath: string, filePath: string): Promise<TextFileResult<string>> {
  const candidate = path.join(repoPath, filePath);
  let handle: fs.promises.FileHandle | undefined;
  try {
    const [root, resolved] = await Promise.all([fs.promises.realpath(repoPath), fs.promises.realpath(candidate)]);
    const relative = path.relative(root, resolved);
    if (escapesParent(relative) || path.isAbsolute(relative)) {
      return textFileFailure('INVALID_REQUEST', 'The diff path escapes the repository.');
    }

    const openFlags = process.platform === 'win32'
      ? fs.constants.O_RDONLY
      : fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    handle = await fs.promises.open(resolved, openFlags);
    const [before, reopened] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.promises.realpath(candidate),
    ]);
    const reopenedRelative = path.relative(root, reopened);
    if (
      escapesParent(reopenedRelative)
      || path.isAbsolute(reopenedRelative)
      || !sameCanonicalPath(resolved, reopened)
    ) {
      return textFileFailure('INVALID_REQUEST', 'The diff path changed outside the repository while JaneT was opening it.');
    }
    const selected = await fs.promises.lstat(reopened, { bigint: true });
    if (!before.isFile() || !selected.isFile()) {
      return textFileFailure('NOT_FILE', 'The diff path is not a regular file.');
    }
    if (
      before.dev !== selected.dev
      || before.ino !== selected.ino
      || (process.platform === 'win32' && before.ino === 0n)
    ) {
      return textFileFailure('CONFLICT', 'The diff path changed while JaneT was opening it.');
    }
    if (before.size > BigInt(MAX_TEXT_FILE_BYTES)) {
      return textFileFailure('TOO_LARGE', 'This diff side is larger than JaneT\'s 2 MiB editor limit.');
    }

    const buffer = Buffer.allocUnsafe(GIT_DIFF_READ_BUFFER_BYTES);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const chunk = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (bytesRead > MAX_TEXT_FILE_BYTES || after.size > BigInt(MAX_TEXT_FILE_BYTES)) {
      return textFileFailure('TOO_LARGE', 'This diff side is larger than JaneT\'s 2 MiB editor limit.');
    }
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || after.size !== BigInt(bytesRead)
    ) {
      return textFileFailure('CONFLICT', 'The working-tree file changed while JaneT was reading it.');
    }
    return decodeSnapshot(Buffer.from(buffer.subarray(0, bytesRead)));
  } catch (error: any) {
    return error?.code === 'ENOENT'
      ? { ok: true, value: '' }
      : textFileFailure('IO', 'The working-tree file could not be read.');
  } finally {
    if (handle) {
      try { await handle.close(); } catch {}
    }
  }
}

function sameCanonicalPath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.normalize(left).toLocaleLowerCase() === path.normalize(right).toLocaleLowerCase()
    : path.normalize(left) === path.normalize(right);
}

function escapesParent(relativePath: string): boolean {
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`);
}

function decodeSnapshot(bytes: Buffer): TextFileResult<string> {
  const decoded = decodeTextFile(bytes);
  return decoded.ok ? { ok: true, value: decoded.value.content } : decoded;
}
