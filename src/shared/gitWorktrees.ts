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

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const drive = normalized.match(/^[A-Za-z]:/)?.[0] ?? '';
  const unc = !drive && normalized.startsWith('//');
  const remainder = unc ? normalized.slice(2) : normalized.slice(drive.length);
  const absolute = unc || remainder.startsWith('/');
  const protectedSegments = unc ? 2 : 0;
  const segments: string[] = [];
  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > protectedSegments && segments.at(-1) !== '..') {
        segments.pop();
      } else if (!absolute) {
        segments.push('..');
      }
      continue;
    }
    segments.push(segment);
  }
  const prefix = unc ? '//' : `${drive}${absolute ? '/' : ''}`;
  return `${prefix}${segments.join('/')}` || '.';
}

export function defaultWorktreePath(repoPath: string, branch: string, baseDir = '../', template = '{repo}-{branch}'): string {
  const repo = basename(repoPath);
  const branchName = sanitizeBranchForPath(branch);
  const name = (template || '{repo}-{branch}')
    .replace(/\{repo\}/g, repo)
    .replace(/\{branch\}/g, branchName);
  const base = baseDir.trim() || '../';
  if (/^[A-Za-z]:[\\/]/.test(base) || /^[\\/]{2}/.test(base)) {
    return `${base.replace(/[\\/]+$/, '')}/${name}`;
  }
  if (/^[\\/]/.test(base)) {
    const normalizedRepo = repoPath.replace(/\\/g, '/');
    const root = normalizedRepo.match(/^[A-Za-z]:/)?.[0]
      ?? normalizedRepo.match(/^\/\/[^/]+\/[^/]+/)?.[0]
      ?? '';
    return `${root}${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${name}`;
  }
  return normalizePath(`${repoPath}/${base}/${name}`);
}
