export interface WorkspaceGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  kind?: 'folder';
  directory?: string;
}

export const DEFAULT_WORKSPACE_GROUP: WorkspaceGroup = { id: 'default', name: 'My workspaces' };
export const MAX_WORKSPACE_GROUPS = 64;

/** Only a workspace's immediate child directory owns a persistent project. */
export function isWorkspaceProject(tab: { groupId?: string; cwd?: string }, groups: WorkspaceGroup[]): boolean {
  const group = groups.find((entry) => entry.id === tab.groupId);
  if (!group || group.kind === 'folder' || !group.directory || !tab.cwd) return false;
  const normalize = (value: string) => {
    const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
    return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const base = normalize(group.directory);
  const directory = normalize(tab.cwd);
  return directory.slice(0, directory.lastIndexOf('/')) === base && directory !== base;
}

/** Rebase only local path descendants, not similarly prefixed siblings. */
export function rebaseDirectory(value: string | undefined, source: string, target: string): string | undefined {
  if (!value) return value;
  const normalized = value.replaceAll('\\', '/');
  const base = source.replaceAll('\\', '/').replace(/\/$/, '');
  const windows = /^[a-z]:|^\/\//i.test(base);
  const candidate = windows ? normalized.toLowerCase() : normalized;
  const prefix = windows ? base.toLowerCase() : base;
  if (candidate !== prefix && !candidate.startsWith(`${prefix}/`)) return value;
  return target.replace(/[\\/]$/, '') + normalized.slice(base.length).replaceAll('/', target.includes('\\') ? '\\' : '/');
}

export function isWorkspaceGroup(value: unknown): value is WorkspaceGroup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const group = value as WorkspaceGroup;
  return Object.keys(group).every((key) => ['id', 'name', 'collapsed', 'kind', 'directory'].includes(key))
    && typeof group.id === 'string' && group.id.length > 0 && group.id.length <= 256
    && typeof group.name === 'string' && group.name.trim().length > 0 && group.name.length <= 256
    && (group.collapsed === undefined || typeof group.collapsed === 'boolean')
    && (group.kind === undefined || group.kind === 'folder')
    && (group.directory === undefined || (typeof group.directory === 'string' && /^(?:[a-z]:[\\/]|[\\/])/.test(group.directory.toLowerCase()) && group.directory.length <= 8192 && !group.directory.includes('\0')))
    && (group.kind !== 'folder' || Boolean(group.directory));
}

export function normalizeWorkspaceGroups(value: unknown): WorkspaceGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, MAX_WORKSPACE_GROUPS).filter((group): group is WorkspaceGroup => {
    if (!isWorkspaceGroup(group) || ids.has(group.id)) return false;
    ids.add(group.id);
    return true;
  }).map((group) => ({ ...group }));
}
