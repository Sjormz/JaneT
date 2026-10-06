import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { parseWorktreePorcelain, GitWorktreeInfo } from '../shared/gitWorktrees';
import { decodeTextFile } from './textFileCodec';
import { MAX_TEXT_FILE_BYTES, textFileFailure, type TextFileResult } from '../shared/textFiles';
import type { GitDiffResult, GitDiffSide } from '../shared/gitDiff';
import { MAX_GIT_ERROR_LENGTH, type GitActionResult, type GitFailure, type GitResult } from '../shared/gitResults';

let simpleGit: any = null;
try {
  simpleGit = require('simple-git').simpleGit;
} catch {
  // simple-git is optional at runtime; IPC methods report Git as unavailable.
}

const MAX_GIT_LOG_ENTRIES = 1_000;
const GIT_DIFF_READ_BUFFER_BYTES = MAX_TEXT_FILE_BYTES + 1;
const MAX_GIT_PATH_LENGTH = 32_768;
const MAX_BRANCH_NAME_LENGTH = 255;
const MAX_REVISION_LENGTH = 1_024;

/**
 * Inactivity bounds for Git subprocesses (simple-git's block timeout resets
 * whenever Git writes output). Reads should be quick; local mutations may run
 * hooks; network operations and commands that commonly run hooks
 * (commit, switch, worktree add) may wait on credentials or slow remotes.
 */
export const GIT_READ_TIMEOUT_MS = 20_000;
export const GIT_LOCAL_TIMEOUT_MS = 60_000;
export const GIT_LONG_TIMEOUT_MS = 300_000;

function gitClient(repoPath: string, timeoutMs: number): any {
  return simpleGit({
    baseDir: repoPath,
    timeout: { block: timeoutMs },
    // simple-git treats a non-zero exit with empty stderr as success (for
    // example `commit` with nothing to commit reports on stdout). Every
    // non-zero exit is a failure here; explain it with stderr, else stdout.
    errors: (
      error: Buffer | Error | undefined,
      result: { exitCode: number; stdOut: Buffer[]; stdErr: Buffer[] },
    ): Buffer | Error | undefined => {
      if (error instanceof Error && (error as { plugin?: unknown }).plugin) return error;
      if (!result.exitCode) return error;
      const stderr = Buffer.concat(result.stdErr);
      return stderr.toString('utf8').trim() ? stderr : Buffer.concat(result.stdOut);
    },
  });
}

function failure(error: string): GitFailure {
  return { ok: false, error };
}

const GIT_UNAVAILABLE = 'Git support is unavailable in this build of JaneT.';

/**
 * Reduce Git's stderr to a short, single-line explanation that is safe to
 * show: terminal escapes and control characters are removed, credentials in
 * URLs, auth headers, and well-known token shapes are redacted, `hint:` lines
 * are dropped when there is a real error line, and the result is bounded.
 */
export function sanitizeGitMessage(raw: string): string {
  let text = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ' ');
  text = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1***@')
    .replace(/\b((?:proxy-)?authorization)\s*:\s*\S+(?:\s+\S+)?/gi, '$1: ***')
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b(basic)\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{12,}={0,2}/gi, '$1 ***')
    .replace(/([?&](?:access_token|token|private_token|password|passwd|pwd|key|secret)=)[^&\s]+/gi, '$1***')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '***');
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const meaningful = lines.filter((line) => !/^hint:/i.test(line));
  const message = (meaningful.length > 0 ? meaningful : lines).join(' ');
  return message.length > MAX_GIT_ERROR_LENGTH
    ? `${message.slice(0, MAX_GIT_ERROR_LENGTH - 1).trimEnd()}…`
    : message;
}

/** Explain a failed Git subprocess without leaking secrets or unbounded output. */
export function describeGitFailure(error: unknown, timeoutMs: number): string {
  const details = error as { message?: unknown; plugin?: unknown; code?: unknown } | null;
  const raw = typeof details?.message === 'string' ? details.message : typeof error === 'string' ? error : '';
  if (details?.plugin === 'timeout' || /block timeout reached/i.test(raw)) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return `Git did not respond for ${seconds} second${seconds === 1 ? '' : 's'}, so JaneT stopped waiting. `
      + 'It may be waiting for credentials, a hook, or the network. Check the repository before retrying.';
  }
  if (details?.code === 'ENOENT' || /spawn git(?:\.exe)? ENOENT/i.test(raw)) {
    return 'Git is not installed or is not on PATH.';
  }
  if (/Cannot use simple-git on a directory that does not exist/i.test(raw)) {
    return 'The repository folder is no longer available.';
  }
  return sanitizeGitMessage(raw) || 'Git failed without an error message.';
}

function repoPathError(repoPath: unknown): string | null {
  return typeof repoPath === 'string'
    && repoPath.length > 0
    && repoPath.length <= MAX_GIT_PATH_LENGTH
    && !repoPath.includes('\0')
    && path.isAbsolute(repoPath)
    ? null
    : 'The repository path must be an absolute folder path.';
}

function displayValue(value: string): string {
  return value.length > 80 ? `${value.slice(0, 79)}…` : value;
}

/**
 * Validate a branch name with Git's `check-ref-format --branch` rules for
 * `refs/heads/<name>`, and reject option-shaped values outright.
 */
export function branchNameError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a branch name.';
  const name = value.trim();
  const label = `"${displayValue(name.replace(/[\u0000-\u001f\u007f]/g, '?'))}" is not a valid branch name`;
  if (name.length > MAX_BRANCH_NAME_LENGTH) return `Branch names are limited to ${MAX_BRANCH_NAME_LENGTH} characters.`;
  if (name.startsWith('-')) return `${label}: it cannot start with "-".`;
  if (name === 'HEAD' || name === '@') return `${label}.`;
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) {
    return `${label}: remove spaces, control characters, and any of ~ ^ : ? * [ \\.`;
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) {
    return `${label}: it cannot contain "..", "@{", or "//".`;
  }
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) {
    return `${label}: it cannot start or end with "/" or end with ".".`;
  }
  if (name.split('/').some((component) => component.startsWith('.') || component.endsWith('.lock'))) {
    return `${label}: no part may start with "." or end with ".lock".`;
  }
  return null;
}

/** Validate an optional start-point revision (branch, tag, or commit). */
export function revisionError(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'The start point must be text.';
  const revision = value.trim();
  if (!revision) return null;
  if (revision.length > MAX_REVISION_LENGTH) return 'The start point is too long.';
  if (revision.startsWith('-')) return `Start point "${displayValue(revision)}" cannot start with "-".`;
  if (/[\u0000-\u001f\u007f]/.test(revision)) return 'The start point cannot contain control characters.';
  return null;
}

function worktreePathError(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a worktree folder.';
  const worktreePath = value.trim();
  if (worktreePath.length > MAX_GIT_PATH_LENGTH) return 'The worktree folder path is too long.';
  if (/[\u0000-\u001f\u007f]/.test(worktreePath)) return 'The worktree folder path cannot contain control characters.';
  if (worktreePath.startsWith('-')) return `Worktree folder "${displayValue(worktreePath)}" cannot start with "-".`;
  return null;
}

function optionalBooleanError(value: unknown, label: string): string | null {
  return value === undefined || typeof value === 'boolean' ? null : `${label} must be true or false.`;
}

function firstError(...errors: Array<string | null>): string | null {
  return errors.find((error): error is string => Boolean(error)) ?? null;
}

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
  // `--end-of-options` keeps user-entered paths and revisions positional even
  // if validation is bypassed (Git 2.24+ parse-options).
  if (createBranch) {
    return [
      'worktree', 'add', '-b', cleanBranch, '--end-of-options', cleanPath,
      ...(cleanStartPoint ? [cleanStartPoint] : []),
    ];
  }
  return ['worktree', 'add', '--end-of-options', cleanPath, cleanBranch];
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

export interface GitTimeouts {
  read: number;
  local: number;
  long: number;
}

export class GitManager {
  private readonly timeouts: GitTimeouts;

  constructor(options: { timeouts?: Partial<GitTimeouts> } = {}) {
    this.timeouts = {
      read: GIT_READ_TIMEOUT_MS,
      local: GIT_LOCAL_TIMEOUT_MS,
      long: GIT_LONG_TIMEOUT_MS,
      ...options.timeouts,
    };
  }

  async findRepo(startPath: string): Promise<string | null> {
    // A relative start path would resolve against JaneT's own process cwd.
    if (repoPathError(startPath)) return null;
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

  async status(repoPath: string): Promise<GitResult<GitStatusResult>> {
    if (!simpleGit) return failure(GIT_UNAVAILABLE);
    const invalid = repoPathError(repoPath);
    if (invalid) return failure(invalid);
    try {
      const status = await gitClient(repoPath, this.timeouts.read).raw([
        '--no-optional-locks', 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all',
      ]);
      return { ok: true, value: parseGitStatusPorcelain(status) };
    } catch (error) {
      return failure(describeGitFailure(error, this.timeouts.read));
    }
  }

  async branches(repoPath: string): Promise<GitBranchInfo[] | null> {
    const details = await this.details(repoPath);
    return details?.branches ?? null;
  }

  async details(repoPath: string): Promise<GitDetailsResult | null> {
    if (!simpleGit || repoPathError(repoPath)) return null;
    try {
      const git = gitClient(repoPath, this.timeouts.read);
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
    if (
      !simpleGit || repoPathError(repoPath)
      || !Number.isInteger(maxCount) || maxCount < 1 || maxCount > MAX_GIT_LOG_ENTRIES
    ) return null;
    try {
      const log = await gitClient(repoPath, this.timeouts.read).log({ maxCount });
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

  async checkout(repoPath: string, branch: string): Promise<GitActionResult> {
    return this.switchBranch(repoPath, branch);
  }

  async switchBranch(repoPath: string, branch: string): Promise<GitActionResult> {
    const invalid = firstError(repoPathError(repoPath), branchNameError(branch));
    if (invalid) return failure(invalid);
    return this.run(repoPath, ['switch', '--end-of-options', branch.trim()], this.timeouts.long);
  }

  async createBranch(repoPath: string, branch: string, startPoint?: string, checkout: boolean = true): Promise<GitActionResult> {
    const invalid = firstError(
      repoPathError(repoPath),
      branchNameError(branch),
      revisionError(startPoint),
      optionalBooleanError(checkout, 'Checkout'),
    );
    if (invalid) return failure(invalid);
    const cleanStartPoint = startPoint?.trim();
    const args = checkout === false
      ? ['branch', '--end-of-options', branch.trim()]
      : ['switch', '-c', branch.trim(), '--end-of-options'];
    if (cleanStartPoint) args.push(cleanStartPoint);
    return this.run(repoPath, args, this.timeouts.long);
  }

  async deleteBranch(repoPath: string, branch: string, force: boolean = false): Promise<GitActionResult> {
    const invalid = firstError(repoPathError(repoPath), branchNameError(branch), optionalBooleanError(force, 'Force'));
    if (invalid) return failure(invalid);
    return this.run(repoPath, ['branch', force === true ? '-D' : '-d', '--end-of-options', branch.trim()], this.timeouts.local);
  }

  async stage(repoPath: string, paths: string[]): Promise<GitActionResult> {
    const invalid = firstError(repoPathError(repoPath), validGitPaths(paths) ? null : 'Choose files inside the repository to stage.');
    if (invalid) return failure(invalid);
    return this.run(repoPath, paths.length === 0
      ? ['add', '-A']
      : ['--literal-pathspecs', 'add', '--', ...paths], this.timeouts.local);
  }

  async unstage(repoPath: string, paths: string[]): Promise<GitActionResult> {
    const invalid = firstError(repoPathError(repoPath), validGitPaths(paths) ? null : 'Choose files inside the repository to unstage.');
    if (invalid) return failure(invalid);
    return this.run(repoPath, [
      ...(paths.length > 0 ? ['--literal-pathspecs'] : []),
      'reset', '--', ...paths,
    ], this.timeouts.local);
  }

  async discard(repoPath: string, paths: string[]): Promise<GitActionResult> {
    const invalid = firstError(
      repoPathError(repoPath),
      validGitPaths(paths) && paths.length > 0 ? null : 'Choose tracked files inside the repository to revert.',
    );
    if (invalid) return failure(invalid);
    return this.run(repoPath, ['--literal-pathspecs', 'restore', '--worktree', '--', ...paths], this.timeouts.local);
  }

  async deleteUntracked(repoPath: string, filePath: string): Promise<GitActionResult> {
    if (!simpleGit) return failure(GIT_UNAVAILABLE);
    const invalid = firstError(
      repoPathError(repoPath),
      validGitPath(filePath) ? null : 'Choose an untracked item inside the repository.',
    );
    if (invalid) return failure(invalid);
    const repository = await resolveGitRepository(repoPath);
    if (!repository.ok) return failure(repository.error.message);
    const candidate = path.resolve(repository.value, filePath);
    const relative = path.relative(repository.value, candidate);
    if (!relative || escapesParent(relative) || path.isAbsolute(relative)) {
      return failure('Choose an untracked item inside the repository.');
    }
    let directory: boolean;
    try {
      directory = (await fs.promises.lstat(candidate)).isDirectory();
    } catch {
      return failure(`${displayValue(filePath)} no longer exists.`);
    }
    const cleaned = await this.run(
      repository.value,
      ['--literal-pathspecs', 'clean', '-f', ...(directory ? ['-d'] : []), '--', filePath],
      this.timeouts.local,
    );
    if (!cleaned.ok) return cleaned;
    try {
      await fs.promises.lstat(candidate);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return { ok: true };
      return failure(`Could not confirm that ${displayValue(filePath)} was deleted.`);
    }
    return failure(`Git did not delete ${displayValue(filePath)}. It may be tracked or ignored.`);
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

  async commit(repoPath: string, message: string): Promise<GitActionResult> {
    const cleanMessage = typeof message === 'string' ? message.trim() : '';
    const invalid = firstError(
      repoPathError(repoPath),
      cleanMessage && cleanMessage.length <= 10_000 && !cleanMessage.includes('\0')
        ? null
        : 'Enter a commit message of up to 10,000 characters.',
    );
    if (invalid) return failure(invalid);
    return this.run(repoPath, ['commit', '-m', cleanMessage], this.timeouts.long);
  }

  async fetch(repoPath: string): Promise<GitActionResult> {
    return this.runChecked(repoPath, ['fetch', '--all', '--prune'], this.timeouts.long);
  }

  async pull(repoPath: string): Promise<GitActionResult> {
    return this.runChecked(repoPath, ['pull', '--ff-only'], this.timeouts.long);
  }

  async push(repoPath: string): Promise<GitActionResult> {
    return this.runChecked(repoPath, ['push'], this.timeouts.long);
  }

  private async runChecked(repoPath: string, args: string[], timeoutMs: number): Promise<GitActionResult> {
    const invalid = repoPathError(repoPath);
    return invalid ? failure(invalid) : this.run(repoPath, args, timeoutMs);
  }

  /** Run a validated Git command, bounded by an inactivity timeout. */
  private async run(repoPath: string, args: string[], timeoutMs: number): Promise<GitActionResult> {
    if (!simpleGit) return failure(GIT_UNAVAILABLE);
    try {
      await gitClient(repoPath, timeoutMs).raw(args);
      return { ok: true };
    } catch (error) {
      return failure(describeGitFailure(error, timeoutMs));
    }
  }

  async worktrees(repoPath: string): Promise<GitWorktreeInfo[] | null> {
    if (!simpleGit || repoPathError(repoPath)) return null;
    try {
      const raw = await gitClient(repoPath, this.timeouts.read).raw(['worktree', 'list', '--porcelain', '-z']);
      return parseWorktreePorcelain(raw);
    } catch {
      return null;
    }
  }

  async addWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    createBranch: boolean = false,
    startPoint?: string,
  ): Promise<GitActionResult> {
    const invalid = firstError(
      repoPathError(repoPath),
      branchNameError(branch),
      worktreePathError(worktreePath),
      optionalBooleanError(createBranch, 'Create branch'),
      createBranch === true ? revisionError(startPoint) : null,
    );
    if (invalid) return failure(invalid);
    const args = buildAddWorktreeArgs(worktreePath, branch, createBranch === true, createBranch === true ? startPoint : undefined);
    return this.run(repoPath, args, this.timeouts.long);
  }

  async removeWorktree(repoPath: string, worktreePath: string, force: boolean = false): Promise<GitActionResult> {
    const invalid = firstError(repoPathError(repoPath), worktreePathError(worktreePath), optionalBooleanError(force, 'Force'));
    if (invalid) return failure(invalid);
    return this.run(
      repoPath,
      ['worktree', 'remove', ...(force === true ? ['-f'] : []), '--end-of-options', worktreePath.trim()],
      this.timeouts.local,
    );
  }

  async pruneWorktrees(repoPath: string): Promise<GitActionResult> {
    return this.runChecked(repoPath, ['worktree', 'prune'], this.timeouts.local);
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
      { cwd: repoPath, encoding: 'buffer', maxBuffer: MAX_TEXT_FILE_BYTES + 1, windowsHide: true, timeout: GIT_READ_TIMEOUT_MS },
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
      { cwd: repoPath, encoding: 'buffer', maxBuffer: 1_024, windowsHide: true, timeout: GIT_READ_TIMEOUT_MS },
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
    // Some filesystems (FAT/exFAT, some network shares) report no file id
    // (ino 0). Then fall back to metadata here and a content re-read below.
    const hasFileIdentity = before.ino !== 0n && selected.ino !== 0n;
    if (hasFileIdentity
      ? before.dev !== selected.dev || before.ino !== selected.ino
      : !sameFileMetadata(before, selected)) {
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
    const contents = buffer.subarray(0, bytesRead);
    if (!hasFileIdentity && !(await pathStillHolds(reopened, after, contents, openFlags))) {
      return textFileFailure('CONFLICT', 'The working-tree file changed while JaneT was reading it.');
    }
    return decodeSnapshot(Buffer.from(contents));
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

function sameFileMetadata(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.birthtimeNs === right.birthtimeNs;
}

/**
 * Without a file id, confirm that the path still names a file with the same
 * metadata and bytes as the handle JaneT read.
 */
async function pathStillHolds(
  filePath: string,
  expected: fs.BigIntStats,
  contents: Buffer,
  openFlags: number,
): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    const selected = await fs.promises.lstat(filePath, { bigint: true });
    if (!selected.isFile() || !sameFileMetadata(expected, selected)) return false;
    handle = await fs.promises.open(filePath, openFlags);
    const current = await handle.stat({ bigint: true });
    if (!current.isFile() || !sameFileMetadata(expected, current)) return false;
    const buffer = Buffer.allocUnsafe(contents.byteLength + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.byteLength) {
      const chunk = await handle.read(buffer, bytesRead, buffer.byteLength - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    return bytesRead === contents.byteLength && buffer.subarray(0, bytesRead).equals(contents);
  } catch {
    return false;
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
