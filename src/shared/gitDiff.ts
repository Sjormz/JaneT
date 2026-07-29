import type { TextFileResult } from './textFiles';

export type GitDiffSide = 'staged' | 'unstaged';

export interface GitDiffRequest {
  repoPath: string;
  filePath: string;
  side: GitDiffSide;
  originalPath?: string;
}

export interface GitDiffSnapshot extends GitDiffRequest {
  originalContent: string;
  modifiedContent: string;
}

export type GitDiffResult = TextFileResult<GitDiffSnapshot>;
