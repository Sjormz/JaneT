export interface WorkspaceGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  kind?: 'folder';
  directory?: string;
}

export const DEFAULT_WORKSPACE_GROUP: WorkspaceGroup = { id: 'default', name: 'My workspaces' };
export const MAX_WORKSPACE_GROUPS = 64;

type ProjectCandidate = { groupId?: string; cwd?: string; isProject?: boolean };

/** Comparable form of a directory path: forward slashes, no trailing slash, case-folded on Windows paths. */
export function normalizeDirectory(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function isDirectChildDirectory(directory: string, parent: string): boolean {
  const base = normalizeDirectory(parent);
  const child = normalizeDirectory(directory);
  return child !== base && child.slice(0, child.lastIndexOf('/')) === base;
}

export function sameDirectory(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && normalizeDirectory(left) === normalizeDirectory(right));
}

/** True when `child` is `parent` or a path descendant of it (not a similarly prefixed sibling). */
export function containsDirectory(parent: string, child: string): boolean {
  const base = normalizeDirectory(parent);
  const candidate = normalizeDirectory(child);
  return candidate === base || candidate.startsWith(`${base}/`);
}

/**
 * True only for the project that owns a Workspace's direct child folder. Every
 * other project (a Library project, a Git worktree project, or a project that
 * starts somewhere else) is a named set of terminals: renaming it changes only
 * its label, and removing it never touches files.
 */
export function ownsWorkspaceProjectFolder(tab: ProjectCandidate, groups: WorkspaceGroup[]): boolean {
  const group = groups.find((entry) => entry.id === tab.groupId);
  return Boolean(group && !group.kind && group.directory && tab.cwd && tab.isProject === true
    && isDirectChildDirectory(tab.cwd, group.directory));
}

/**
 * Tabs saved before project ownership was explicit stored no `isProject`
 * value. A tab for a Workspace's direct child folder is that folder's project
 * when it has no terminals (only projects outlive their last terminal) or when
 * the workspace has no explicit project and it is the first tab for that
 * folder; later tabs sharing the folder were opened from it. Workspaces that
 * already contain explicit projects were saved by a build that flags every new
 * project, so their unflagged tabs were sessions. Every other unflagged tab is
 * marked `isProject: false` here; `migrateSessionsToProjects` then folds those
 * former sessions into projects.
 */
export function resolveLegacyWorkspaceProjects<T extends ProjectCandidate>(
  tabs: T[],
  groups: WorkspaceGroup[],
  hasTerminals: (tab: T) => boolean,
): T[] {
  const folderKey = (tab: T) => `${tab.groupId}\0${normalizeDirectory(tab.cwd!)}`;
  const explicitGroups = new Set(tabs.filter((tab) => tab.isProject === true).map((tab) => tab.groupId));
  const explicitFolders = new Set(tabs.filter((tab) => tab.isProject === true && tab.cwd).map(folderKey));
  const candidateKey = (tab: T): string | null => {
    if (tab.isProject !== undefined) return null;
    const group = groups.find((entry) => entry.id === tab.groupId);
    if (!group || group.kind || !group.directory || !tab.cwd || !isDirectChildDirectory(tab.cwd, group.directory)) return null;
    const key = folderKey(tab);
    return explicitFolders.has(key) ? null : key;
  };
  const owners = new Map<string, T>();
  // Terminal-less tabs are unambiguous, so they claim their folder first.
  for (const tab of tabs) {
    const key = candidateKey(tab);
    if (key && !hasTerminals(tab) && !owners.has(key)) owners.set(key, tab);
  }
  for (const tab of tabs) {
    const key = candidateKey(tab);
    if (key && !owners.has(key) && !explicitGroups.has(tab.groupId)) owners.set(key, tab);
  }
  const ownerTabs = new Set(owners.values());
  return tabs.map((tab) => tab.isProject !== undefined ? tab : { ...tab, isProject: ownerTabs.has(tab) });
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
