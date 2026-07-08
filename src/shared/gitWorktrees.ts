export interface GitWorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked?: string;
  prunable?: string;
}

export function parseWorktreePorcelain(raw: string): GitWorktreeInfo[] {
  const records: GitWorktreeInfo[] = [];
  let current: GitWorktreeInfo | null = null;

  for (const field of raw.split('\0')) {
    if (!field) {
      if (current) records.push(current);
      current = null;
      continue;
    }

    const [key, ...rest] = field.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') {
      if (current) records.push(current);
      current = { path: value, head: '', bare: false, detached: false };
      continue;
    }
    if (!current) continue;
    if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'bare') current.bare = true;
    else if (key === 'detached') current.detached = true;
    else if (key === 'locked') current.locked = value || 'locked';
    else if (key === 'prunable') current.prunable = value || 'prunable';
  }
  if (current) records.push(current);
  return records;
}

export function sanitizeBranchForPath(branch: string): string {
  return branch.trim().replace(/^refs\/heads\//, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? normalized : normalized.slice(0, index);
}

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || normalized;
}

export function defaultWorktreePath(repoPath: string, branch: string, baseDir = '../', template = '{repo}-{branch}'): string {
  const repo = basename(repoPath);
  const branchName = sanitizeBranchForPath(branch);
  const name = (template || '{repo}-{branch}')
    .replace(/\{repo\}/g, repo)
    .replace(/\{branch\}/g, branchName);
  const base = baseDir.trim() || '../';
  if (/^[A-Za-z]:[\\/]/.test(base) || base.startsWith('/') || base.startsWith('\\\\')) {
    return `${base.replace(/[\\/]+$/, '')}/${name}`;
  }
  return `${dirname(repoPath)}/${name}`;
}
