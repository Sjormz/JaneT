import { PaneNode, TerminalLeaf, SplitNode, genId } from './types';
import type { StartupShellDialect } from '../shared/startupCommands';
import { isStartupShellDialect, sanitizeStartupCommands } from '../shared/startupCommands';

export interface SavedPaneLeaf {
  type: 'leaf';
  title?: string;
  terminalType?: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  startupCommands?: string[];
  startupShellDialect?: StartupShellDialect;
}

export interface SavedPaneSplit {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  sizes: number[];
  children: SavedPaneNode[];
}

export type SavedPaneNode = SavedPaneLeaf | SavedPaneSplit;

export interface SavedTab {
  id: string;
  title: string;
  type: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  root: SavedPaneNode;
}

export interface SavedSession {
  tabs: SavedTab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  tabsOpen: boolean;
  sidebarSection: 'files' | 'ssh' | 'git' | 'settings';
}

const VALID_SECTIONS = new Set(['files', 'ssh', 'git', 'settings']);
export const MAX_RESTORED_TABS = 64;
export const MAX_RESTORED_TERMINALS = 64;
const MAX_PANE_TREE_DEPTH = 64;
const MAX_PANE_TREE_NODES = 128;
const MAX_PANE_TREE_LEAVES = 64;

function normalizeSizes(sizes: unknown, count: number): number[] {
  if (!Array.isArray(sizes) || sizes.length !== count || !sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)) {
    return new Array<number>(count).fill(1 / count);
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0 ? sizes.map((size) => size / total) : new Array<number>(count).fill(1 / count);
}

export interface SerializePaneTreeOptions {
  /** Include startup automation when it must survive serialization. */
  includeStartupCommands?: boolean;
}

/** Strip runtime-only ids and emit a portable, JSON-safe tree. */
export function serializePaneTree(
  node: PaneNode,
  cwdByTerminal: Record<string, string> = {},
  options: SerializePaneTreeOptions = {},
): SavedPaneNode {
  if (node.type === 'leaf') {
    const startupCommands = options.includeStartupCommands
      ? sanitizeStartupCommands(node.startupCommands)
      : [];
    return {
      type: 'leaf',
      ...(node.title ? { title: node.title } : {}),
      ...(node.terminalType ? { terminalType: node.terminalType } : {}),
      ...(cwdByTerminal[node.id] ?? node.cwd ? { cwd: cwdByTerminal[node.id] ?? node.cwd } : {}),
      ...(node.sshProfileId ? { sshProfileId: node.sshProfileId } : {}),
      ...(startupCommands.length > 0 ? { startupCommands } : {}),
      ...(startupCommands.length > 0 && node.terminalType === 'ssh'
        ? { startupShellDialect: isStartupShellDialect(node.startupShellDialect) ? node.startupShellDialect : 'posix' }
        : startupCommands.length > 0 && isStartupShellDialect(node.startupShellDialect)
          ? { startupShellDialect: node.startupShellDialect }
        : {}),
    };
  }
  return {
    type: 'split',
    direction: node.direction,
    sizes: normalizeSizes(node.sizes, node.children.length),
    children: node.children.map((child) => serializePaneTree(child, cwdByTerminal, options)),
  };
}

/**
 * Recreate a PaneNode tree with fresh leaf ids, keeping shape
 * (direction, sizes, child count, leaf titles). Returns null if the
 * input is structurally invalid so a corrupt session silently falls
 * back to a single fresh leaf instead of crashing the app.
 */
export function restorePaneTree(saved: unknown, prefix: 'term' | 'split' = 'term'): PaneNode | null {
  const budget = { remaining: MAX_PANE_TREE_NODES, leavesRemaining: MAX_PANE_TREE_LEAVES, exceeded: false };
  const restored = restorePaneTreeWithinBudget(saved, prefix, 0, budget);
  return budget.exceeded ? null : restored;
}

function restorePaneTreeWithinBudget(
  saved: unknown,
  prefix: 'term' | 'split',
  depth: number,
  budget: { remaining: number; leavesRemaining: number; exceeded: boolean },
): PaneNode | null {
  if (depth > MAX_PANE_TREE_DEPTH || budget.remaining <= 0) {
    budget.exceeded = true;
    return null;
  }
  if (!saved || typeof saved !== 'object') return null;
  budget.remaining -= 1;
  const node = saved as {
    type?: string; title?: string; direction?: string; sizes?: unknown; children?: unknown;
    terminalType?: string; cwd?: string; sshProfileId?: string;
    startupCommands?: unknown; startupShellDialect?: unknown;
  };

  if (node.type === 'leaf') {
    if (budget.leavesRemaining <= 0) {
      budget.exceeded = true;
      return null;
    }
    budget.leavesRemaining -= 1;
    const hasExplicitStartupDialect = node.startupShellDialect !== undefined
      && node.startupShellDialect !== null
      && node.startupShellDialect !== '';
    const startupShellDialect = isStartupShellDialect(node.startupShellDialect)
      ? node.startupShellDialect
      : undefined;
    const validStartupDialect = startupShellDialect !== undefined;
    const startupCommands = node.terminalType === 'ssh'
      && hasExplicitStartupDialect
      && !validStartupDialect
      ? []
      : sanitizeStartupCommands(node.startupCommands);
    const leaf: TerminalLeaf = {
      id: genId(prefix),
      type: 'leaf',
      title: typeof node.title === 'string' ? node.title : undefined,
      terminalType: node.terminalType === 'ssh' || node.terminalType === 'local' ? node.terminalType : undefined,
      cwd: typeof node.cwd === 'string' ? node.cwd : undefined,
      sshProfileId: typeof node.sshProfileId === 'string' ? node.sshProfileId : undefined,
      ...(startupCommands.length > 0 ? { startupCommands } : {}),
      ...(startupCommands.length > 0 && validStartupDialect
        ? { startupShellDialect }
        : startupCommands.length > 0 && node.terminalType === 'ssh'
          ? { startupShellDialect: 'posix' }
          : {}),
    };
    return leaf;
  }

  if (node.type === 'split') {
    const direction = node.direction === 'horizontal' ? 'horizontal' : 'vertical';
    if (!Array.isArray(node.children) || node.children.length === 0) return null;

    const restoredChildren: Array<{ node: PaneNode; index: number }> = [];
    for (const [index, child] of node.children.entries()) {
      const restored = restorePaneTreeWithinBudget(child, prefix, depth + 1, budget);
      if (restored) restoredChildren.push({ node: restored, index });
      if (budget.exceeded) break;
    }
    if (restoredChildren.length === 0) return null;

    const children = restoredChildren.map(({ node: child }) => child);
    const savedSizes = normalizeSizes(node.sizes, node.children.length);
    const sizes = normalizeSizes(restoredChildren.map(({ index }) => savedSizes[index]), children.length);

    const splitNode: SplitNode = {
      id: genId('split'),
      type: 'split',
      direction,
      children,
      sizes,
    };
    return splitNode;
  }

  return null;
}

/** Normalize a raw session blob from disk into a trusted SavedSession. */
export function normalizeSession(raw: unknown): SavedSession {
  const empty: SavedSession = {
    tabs: [],
    activeTabId: null,
    sidebarOpen: true,
    tabsOpen: true,
    sidebarSection: 'files',
  };
  if (!raw || typeof raw !== 'object') return empty;
  const obj = raw as Partial<SavedSession>;

  const section: SavedSession['sidebarSection'] =
    typeof obj.sidebarSection === 'string' && VALID_SECTIONS.has(obj.sidebarSection)
      ? (obj.sidebarSection as SavedSession['sidebarSection'])
      : 'files';

  const tabs: SavedTab[] = [];
  let terminalCount = 0;
  if (Array.isArray(obj.tabs)) {
    for (const tab of obj.tabs.slice(0, MAX_RESTORED_TABS)) {
      if (!isValidSavedTab(tab)) continue;
      const leaves = countSavedPaneLeaves(tab.root, MAX_RESTORED_TERMINALS - terminalCount);
      if (leaves === null) continue;
      terminalCount += leaves;
      tabs.push(tab);
    }
  }

  return {
    tabs,
    activeTabId: typeof obj.activeTabId === 'string' ? obj.activeTabId : null,
    sidebarOpen: obj.sidebarOpen !== false,
    tabsOpen: obj.tabsOpen !== false,
    sidebarSection: section,
  };
}

function countSavedPaneLeaves(root: unknown, limit: number): number | null {
  const pending = [{ node: root, depth: 0 }];
  let nodes = 0;
  let leaves = 0;
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (!node || typeof node !== 'object' || depth > MAX_PANE_TREE_DEPTH) return null;
    nodes += 1;
    if (nodes > MAX_PANE_TREE_NODES) return null;
    const candidate = node as { type?: unknown; children?: unknown };
    if (candidate.type === 'leaf') {
      leaves += 1;
      if (leaves > limit) return null;
    } else if (candidate.type === 'split' && Array.isArray(candidate.children) && candidate.children.length > 0) {
      if (candidate.children.length > MAX_PANE_TREE_NODES - nodes) return null;
      for (const child of candidate.children) pending.push({ node: child, depth: depth + 1 });
    } else {
      return null;
    }
  }
  return leaves;
}

function isValidSavedTab(value: unknown): value is SavedTab {
  if (!value || typeof value !== 'object') return false;
  const tab = value as Partial<SavedTab>;
  return (
    typeof tab.id === 'string' && tab.id.length > 0 &&
    typeof tab.title === 'string' &&
    (tab.type === 'local' || tab.type === 'ssh')
  );
}
