// Folds the former "session" sidebar entries into projects. Shared by the main
// process (settings load, which can also recognize Git worktree folders) and
// the renderer (session restore). It is pure: it never reads or changes the
// user's files, and running it again on its own output changes nothing.

import type { StartupShellDialect } from './startupCommands';
import {
  MAX_WORKSPACE_GROUPS,
  containsDirectory,
  isDirectChildDirectory,
  normalizeDirectory,
  resolveLegacyWorkspaceProjects,
  sameDirectory,
  type WorkspaceGroup,
} from './workspaceGroups';

export interface MigrationPaneLeaf {
  type: 'leaf';
  title?: string;
  terminalType?: 'local';
  cwd?: string;
  startupCommands?: string[];
  startupShellDialect?: StartupShellDialect;
}

export interface MigrationPaneSplit {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  sizes: number[];
  children: MigrationPaneNode[];
}

export type MigrationPaneNode = MigrationPaneLeaf | MigrationPaneSplit;

export interface MigratableTab {
  id: string;
  title: string;
  isProject?: boolean;
  groupId?: string;
  cwd?: string;
  selectedPanePath?: number[];
  maximizedPanePath?: number[];
  root: MigrationPaneNode;
}

export interface SessionMigrationState<T extends MigratableTab> {
  tabs: T[];
  groups: WorkspaceGroup[];
  activeTabId: string | null;
}

export interface SessionMigrationOptions {
  /**
   * Recognizes a linked Git worktree folder without running Git (the main
   * process checks for a `.git` file that points into `.git/worktrees`). The
   * renderer omits it, so worktree sessions it sees merge like other sessions.
   */
  isLinkedWorktree?: (directory: string) => boolean;
}

/** One project's layout never holds more terminals than the app-wide limit. */
export const MAX_PROJECT_TERMINALS = 64;

function leavesOf(node: MigrationPaneNode): MigrationPaneLeaf[] {
  return node.type === 'leaf' ? [node] : node.children.flatMap(leavesOf);
}

function leafAtPath(root: MigrationPaneNode, path: number[] | undefined): MigrationPaneLeaf | undefined {
  if (!path) return undefined;
  let node: MigrationPaneNode | undefined = root;
  for (const index of path) node = node?.type === 'split' ? node.children[index] : undefined;
  return node?.type === 'leaf' ? node : undefined;
}

function pathOfLeaf(root: MigrationPaneNode, leaf: MigrationPaneLeaf | undefined): number[] | undefined {
  if (!leaf) return undefined;
  if (root === leaf) return [];
  if (root.type !== 'split') return undefined;
  for (const [index, child] of root.children.entries()) {
    const path = pathOfLeaf(child, leaf);
    if (path) return [index, ...path];
  }
  return undefined;
}

function mapTree(node: MigrationPaneNode, mapper: (leaf: MigrationPaneLeaf) => MigrationPaneLeaf): MigrationPaneNode {
  return node.type === 'leaf' ? mapper(node) : { ...node, children: node.children.map((child) => mapTree(child, mapper)) };
}

/** The saved-tree form of `arrangePaneGrid`: reading-order rows, the last pane spanning unused cells. */
function arrangeGrid(leaves: MigrationPaneLeaf[]): MigrationPaneNode {
  const columns = Math.max(1, Math.ceil(Math.sqrt(leaves.length)));
  const normalize = (sizes: number[]) => {
    const total = sizes.reduce((sum, size) => sum + size, 0);
    return sizes.map((size) => size / total);
  };
  const rows: MigrationPaneSplit[] = [];
  for (let offset = 0; offset < leaves.length; offset += columns) {
    const row = leaves.slice(offset, offset + columns);
    const remaining = columns - row.length;
    rows.push({
      type: 'split', direction: 'vertical', children: row,
      sizes: normalize(row.map((_, index) => index === row.length - 1 ? 1 + remaining : 1)),
    });
  }
  return rows.length === 1 ? rows[0] : { type: 'split', direction: 'horizontal', children: rows, sizes: normalize(rows.map(() => 1)) };
}

function basename(directory: string): string {
  return directory.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() || directory;
}

/**
 * Turn every non-project entry ("session") into part of a project.
 *
 * Legacy unflagged tabs are first resolved by `resolveLegacyWorkspaceProjects`.
 * Then, in saved order, each former session:
 *
 * 1. If it is a linked Git worktree (only when `isLinkedWorktree` recognizes
 *    it): in a Library entry it becomes (or merges into) that entry's project
 *    for the worktree folder; in a Workspace it moves to a Library entry for
 *    the worktree folder, created when missing and the entry limit allows.
 * 2. Otherwise it merges into a project of the same Workspace or Library
 *    entry: the project whose folder equals the session's folder, else the
 *    deepest project folder containing it, else the first project.
 * 3. A group with no project at all: in a Library entry (or a group without a
 *    managed folder) the session becomes the project. In a Workspace it becomes
 *    the project of its folder when that folder is directly inside the
 *    workspace; otherwise, when it has terminals, a project that owns no folder
 *    (renaming it changes only its label; removing it never touches files).
 *    A session with neither terminals nor a folder is dropped.
 *
 * Merging appends the session's terminals to the project's layout in reading
 * order (the layout is re-flowed like "Add terminals"; an empty project keeps
 * the session's layout as is). Each terminal keeps its title, startup commands
 * and folder; a terminal without its own folder keeps the session's folder. If
 * a merged layout would exceed 64 terminals, the project's own terminals are
 * kept first, then the session's in reading order, and the rest are dropped.
 */
export function migrateSessionsToProjects<T extends MigratableTab>(
  state: SessionMigrationState<T>,
  options: SessionMigrationOptions = {},
): SessionMigrationState<T> {
  const ownership = resolveLegacyWorkspaceProjects(state.tabs, state.groups, (tab) => leavesOf(tab.root).length > 0);
  // Apply the app-wide budget after identifying ownership, before merging.
  // Saved order must not let an earlier session displace a project's terminals.
  let remaining = MAX_PROJECT_TERMINALS;
  const limited = new Map<T, T>();
  const reserve = (tab: T) => {
    const leaves = leavesOf(tab.root);
    const kept = leaves.slice(0, remaining);
    remaining -= kept.length;
    if (kept.length === leaves.length) {
      limited.set(tab, tab);
      return;
    }
    const root: MigrationPaneNode = kept.length > 0 ? arrangeGrid(kept)
      : { type: 'split', direction: 'vertical', children: [], sizes: [] };
    const selectedPanePath = pathOfLeaf(root, leafAtPath(tab.root, tab.selectedPanePath));
    const maximizedPanePath = pathOfLeaf(root, leafAtPath(tab.root, tab.maximizedPanePath));
    const { selectedPanePath: _selected, maximizedPanePath: _maximized, ...rest } = tab;
    limited.set(tab, { ...rest, root,
      ...(selectedPanePath ? { selectedPanePath } : {}),
      ...(maximizedPanePath ? { maximizedPanePath } : {}),
    } as T);
  };
  ownership.filter((tab) => tab.isProject === true).forEach(reserve);
  ownership.filter((tab) => tab.isProject !== true).forEach(reserve);
  const linkedProjects = new Set(ownership.filter((tab) => tab.isProject === true && tab.cwd
    && options.isLinkedWorktree?.(tab.cwd)
    && state.groups.find((group) => group.id === tab.groupId)?.kind !== 'folder').map((tab) => tab.id));
  const resolved = ownership.map((tab) => {
    const limitedTab = limited.get(tab)!;
    return linkedProjects.has(tab.id) ? { ...limitedTab, isProject: false } : limitedTab;
  });
  if (resolved.every((tab) => tab.isProject === true)) {
    return { tabs: resolved, groups: state.groups, activeTabId: state.activeTabId };
  }
  const groups = [...state.groups];
  let activeTabId = state.activeTabId;
  const entries: Array<T | null> = [...resolved];
  // Restore places a tab with an unknown group in the first group.
  const groupOf = (tab: T) => groups.find((group) => group.id === tab.groupId) ?? state.groups[0];
  const groupKey = (tab: T) => groupOf(tab)?.id ?? tab.groupId ?? '';
  const projectsIn = (key: string) => entries.filter((tab): tab is T => tab !== null && tab.isProject === true && groupKey(tab) === key);
  const convert = (index: number, patch: Partial<MigratableTab>) => {
    entries[index] = { ...entries[index]!, ...patch, isProject: true } as T;
  };
  const merge = (index: number, target: T, sessionCwd: string | undefined) => {
    const session = entries[index]!;
    const targetIndex = entries.indexOf(target);
    const sessionSelected = leafAtPath(session.root, session.selectedPanePath);
    const replaced = new Map<MigrationPaneLeaf, MigrationPaneLeaf>();
    const sessionRoot = mapTree(session.root, (leaf) => {
      const next = leaf.cwd || !sessionCwd ? { ...leaf } : { ...leaf, cwd: sessionCwd };
      replaced.set(leaf, next);
      return next;
    });
    const sessionLeaves = leavesOf(sessionRoot);
    const targetLeaves = leavesOf(target.root);
    const activatesSession = activeTabId === session.id;
    let root = target.root;
    if (sessionLeaves.length > 0) {
      root = targetLeaves.length === 0
        ? sessionRoot
        : arrangeGrid([...targetLeaves, ...sessionLeaves].slice(0, MAX_PROJECT_TERMINALS));
    }
    const selected = activatesSession
      ? (sessionSelected && replaced.get(sessionSelected)) ?? sessionLeaves[0] ?? leafAtPath(target.root, target.selectedPanePath)
      : leafAtPath(target.root, target.selectedPanePath);
    const maximized = activatesSession ? undefined : leafAtPath(target.root, target.maximizedPanePath);
    const selectedPanePath = pathOfLeaf(root, selected);
    const maximizedPanePath = pathOfLeaf(root, maximized);
    const { selectedPanePath: _selected, maximizedPanePath: _maximized, ...rest } = target;
    entries[targetIndex] = {
      ...rest, root,
      ...(selectedPanePath ? { selectedPanePath } : {}),
      ...(maximizedPanePath ? { maximizedPanePath } : {}),
    } as T;
    entries[index] = null;
    if (activatesSession) activeTabId = target.id;
  };
  const uniqueGroupId = (base: string) => {
    let id = base.slice(0, 240);
    for (let suffix = 2; groups.some((group) => group.id === id); suffix += 1) id = `${base.slice(0, 240)}-${suffix}`;
    return id;
  };

  resolved.forEach((original, index) => {
    if (original.isProject === true) return;
    const session = entries[index]!;
    const firstLeafCwd = leavesOf(session.root).find((leaf) => leaf.cwd)?.cwd;
    const sessionCwd = session.cwd || firstLeafCwd;
    const group = groupOf(session);
    const key = groupKey(session);
    const hasTerminals = leavesOf(session.root).length > 0;

    if (sessionCwd && options.isLinkedWorktree?.(sessionCwd)) {
      let library = group?.kind === 'folder' ? group
        : groups.find((entry) => entry.kind === 'folder' && sameDirectory(entry.directory, sessionCwd));
      if (!library && groups.length < MAX_WORKSPACE_GROUPS) {
        library = { id: uniqueGroupId(`folder-${session.id}`), name: basename(sessionCwd).slice(0, 256), kind: 'folder', directory: sessionCwd };
        groups.push(library);
      }
      if (!library && linkedProjects.has(session.id) && group && projectsIn(key).length === 0) {
        // At capacity, reclassify the existing entry rather than leave the only
        // worktree project owning a folder that filesystem actions could move.
        library = { ...group, kind: 'folder', directory: sessionCwd };
        groups[groups.findIndex((entry) => entry.id === group.id)] = library;
      }
      if (library) {
        const existing = projectsIn(library.id).find((project) => sameDirectory(project.cwd, sessionCwd))
          ?? (library.id === group?.id ? undefined : projectsIn(library.id)[0]);
        if (existing) merge(index, existing, sessionCwd);
        else convert(index, { groupId: library.id, cwd: sessionCwd });
        return;
      }
    }

    const candidates = projectsIn(key);
    if (candidates.length > 0) {
      const target = (sessionCwd && candidates.find((project) => sameDirectory(project.cwd, sessionCwd)))
        || (sessionCwd && candidates
          .filter((project) => project.cwd && containsDirectory(project.cwd, sessionCwd))
          .sort((left, right) => normalizeDirectory(right.cwd!).length - normalizeDirectory(left.cwd!).length)[0])
        || candidates[0];
      merge(index, target, sessionCwd);
      return;
    }

    const managedWorkspace = group && !group.kind && group.directory;
    if (!managedWorkspace) {
      if (!hasTerminals && !sessionCwd) entries[index] = null;
      else convert(index, { cwd: sessionCwd ?? group?.directory });
      return;
    }
    if (sessionCwd && isDirectChildDirectory(sessionCwd, group.directory!)) convert(index, { cwd: sessionCwd });
    else if (hasTerminals) convert(index, sessionCwd ? { cwd: sessionCwd } : {});
    else entries[index] = null;
  });

  const tabs = entries.filter((tab): tab is T => tab !== null);
  if (activeTabId !== null && !tabs.some((tab) => tab.id === activeTabId)) activeTabId = tabs[0]?.id ?? null;
  return { tabs, groups, activeTabId };
}
