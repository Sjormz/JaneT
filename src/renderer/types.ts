import type { StartupShellDialect } from '../shared/startupCommands';
import { sanitizeStartupCommands } from '../shared/startupCommands';

export interface TerminalLeaf {
  id: string;
  type: 'leaf';
  title?: string;
  terminalType?: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  sshSessionId?: string;
  sshShellReady?: boolean;
  startupCommands?: string[];
  startupShellDialect?: StartupShellDialect;
}

export interface WorkspaceTerminal {
  type: 'local' | 'ssh';
  title?: string;
  cwd?: string;
  sshProfileId?: string;
  startupCommands?: string[];
  startupShellDialect?: StartupShellDialect;
}

export interface SplitNode {
  id: string;
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: PaneNode[];
  sizes: number[];
}

export type PaneNode = TerminalLeaf | SplitNode;

export interface TabInfo {
  id: string;
  title: string;
  type: 'local' | 'ssh';
  workspaceId?: string;
  sshSessionId?: string;
  sshProfileId?: string;
  sshShellReady?: boolean;
  cwd?: string;
  root: PaneNode;
}

export interface SessionInfo {
  id: string;
  host: string;
  port: number;
  username?: string;
  sshProfileId?: string;
}

export interface SavedSSHProfile {
  id: string;
  host: string;
  port: number;
  username?: string;
  auth: 'password' | 'key';
  password?: string;
  privateKey?: string;
  jumpHostProfileId?: string;
}

export interface WorkspaceTabPreset {
  id: string;
  name: string;
  type: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  /** Portable saved pane tree. Legacy presets omit this and use count/direction. */
  root?: import('./sessionRestore').SavedPaneNode;
  terminalCount: number;
  splitDirection: 'horizontal' | 'vertical';
}

let _counter = 0;
export function genId(prefix = 'p'): string {
  return `${prefix}-${++_counter}-${Date.now().toString(36)}`;
}

export function createLeaf(type: 'local' | 'ssh' = 'local'): TerminalLeaf {
  return { id: genId('term'), type: 'leaf', title: type === 'local' ? 'terminal' : 'ssh', terminalType: type };
}

function workspaceLeaf(terminal: WorkspaceTerminal): TerminalLeaf {
  const startupCommands = sanitizeStartupCommands(terminal.startupCommands);
  const title = terminal.title?.trim();
  return {
    id: genId('term'), type: 'leaf', ...(title ? { title } : {}),
    terminalType: terminal.type, cwd: terminal.type === 'local' ? terminal.cwd : undefined,
    sshProfileId: terminal.type === 'ssh' ? terminal.sshProfileId : undefined,
    ...(startupCommands.length > 0 ? { startupCommands } : {}),
    ...(terminal.type === 'ssh' && startupCommands.length > 0
      ? { startupShellDialect: terminal.startupShellDialect ?? 'posix' }
      : {}),
  };
}

/** Creates a balanced initial workspace grid; the final pane spans unused row cells. */
export function createWorkspaceRoot(terminals: WorkspaceTerminal[]): PaneNode {
  const leaves = terminals.length ? terminals.map(workspaceLeaf) : [workspaceLeaf({ type: 'local' })];
  const columns = Math.ceil(Math.sqrt(leaves.length));
  const rows: PaneNode[] = [];
  for (let offset = 0; offset < leaves.length; offset += columns) {
    const row = leaves.slice(offset, offset + columns);
    const remaining = columns - row.length;
    rows.push({
      id: genId('split'), type: 'split', direction: 'vertical', children: row,
      sizes: row.map((_, index) => index === row.length - 1 ? 1 + remaining : 1),
    });
  }
  return rows.length === 1 ? rows[0] : { id: genId('split'), type: 'split', direction: 'horizontal', children: rows, sizes: rows.map(() => 1) };
}

export function createPaneRoot(
  type: 'local' | 'ssh' = 'local',
  terminalCount = 1,
  direction: 'horizontal' | 'vertical' = 'vertical',
): PaneNode {
  const count = Math.max(1, Math.min(8, Math.floor(terminalCount) || 1));
  const children = Array.from({ length: count }, () => createLeaf(type));
  return {
    id: genId('split'),
    type: 'split',
    direction,
    children,
    sizes: children.map(() => 1),
  };
}

export function splitPane(
  tree: PaneNode,
  targetLeafId: string,
  direction: 'horizontal' | 'vertical',
): PaneNode {
  if (tree.type === 'leaf') {
    if (tree.id === targetLeafId) {
      const newNode: SplitNode = {
        id: genId('split'),
        type: 'split',
        direction,
        children: [
          tree,
          { id: genId('term'), type: 'leaf', title: 'terminal' },
        ],
        sizes: [1, 1],
      };
      return newNode;
    }
    return tree;
  }

  if (
    tree.children.length === 1
    && tree.children[0].type === 'leaf'
    && tree.children[0].id === targetLeafId
  ) {
    return {
      ...tree,
      direction,
      children: [
        tree.children[0],
        { id: genId('term'), type: 'leaf', title: 'terminal' },
      ],
      sizes: [1, 1],
    };
  }

  if (tree.direction === direction) {
    const targetIndex = tree.children.findIndex(
      (child) => child.type === 'leaf' && child.id === targetLeafId,
    );
    if (targetIndex >= 0) {
      const newLeaf: TerminalLeaf = { id: genId('term'), type: 'leaf', title: 'terminal' };
      return {
        ...tree,
        children: [
          ...tree.children.slice(0, targetIndex + 1),
          newLeaf,
          ...tree.children.slice(targetIndex + 1),
        ],
        sizes: [
          ...tree.sizes.slice(0, targetIndex + 1),
          1,
          ...tree.sizes.slice(targetIndex + 1),
        ],
      };
    }
  }

  const newChildren = tree.children.map((child) => splitPane(child, targetLeafId, direction));
  const changed = newChildren.some((child, i) => child !== tree.children[i]);
  if (!changed) return tree;

  return { ...tree, children: newChildren };
}

export function removePane(tree: PaneNode, targetLeafId: string): PaneNode | null {
  if (tree.type === 'leaf') {
    return tree.id === targetLeafId ? null : tree;
  }

  const remaining = tree.children
    .map((child) => removePane(child, targetLeafId))
    .filter((child): child is PaneNode => child !== null);

  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0];

  const removedIndex = tree.children.findIndex(
    (child) => findLeaf(child, targetLeafId) !== null,
  );
  let newSizes: number[];
  if (removedIndex >= 0) {
    newSizes = tree.sizes.filter((_, i) => {
      const child = tree.children[i];
      if (child.type === 'leaf' && child.id === targetLeafId) return false;
      if (findLeaf(child, targetLeafId) !== null) return false;
      return true;
    });
  } else {
    newSizes = tree.sizes.slice(0, remaining.length);
  }

  const total = newSizes.reduce((a, b) => a + b, 0);
  if (total > 0) {
    newSizes = newSizes.map((s) => s / total);
  } else {
    newSizes = remaining.map(() => 1);
  }

  return { ...tree, children: remaining, sizes: newSizes };
}

export type PaneDropSide = 'top' | 'right' | 'bottom' | 'left';

interface PaneRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function paneRects(
  tree: PaneNode,
  left = 0,
  top = 0,
  right = 1,
  bottom = 1,
): PaneRect[] {
  if (tree.type === 'leaf') return [{ id: tree.id, left, top, right, bottom }];
  const sizes = tree.sizes.length === tree.children.length
    && tree.sizes.every((size) => Number.isFinite(size) && size > 0)
    ? tree.sizes
    : tree.children.map(() => 1);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  let offset = tree.direction === 'vertical' ? left : top;
  return tree.children.flatMap((child, index) => {
    const fraction = sizes[index] / total;
    if (tree.direction === 'vertical') {
      const childRight = index === tree.children.length - 1
        ? right
        : offset + (right - left) * fraction;
      const rects = paneRects(child, offset, top, childRight, bottom);
      offset = childRight;
      return rects;
    }
    const childBottom = index === tree.children.length - 1
      ? bottom
      : offset + (bottom - top) * fraction;
    const rects = paneRects(child, left, offset, right, childBottom);
    offset = childBottom;
    return rects;
  });
}

/** Selects the nearest pane in one visual direction, with tree order breaking ties. */
export function directionalPaneTarget(
  tree: PaneNode,
  sourceLeafId: string,
  side: PaneDropSide,
): string | null {
  const rects = paneRects(tree);
  const source = rects.find((rect) => rect.id === sourceLeafId);
  if (!source) return null;
  const horizontal = side === 'left' || side === 'right';
  const sourcePrimary = horizontal
    ? (source.left + source.right) / 2
    : (source.top + source.bottom) / 2;
  const sourceOrthogonal = horizontal
    ? (source.top + source.bottom) / 2
    : (source.left + source.right) / 2;
  const sign = side === 'right' || side === 'bottom' ? 1 : -1;
  return rects
    .map((rect, index) => {
      const primary = horizontal
        ? (rect.left + rect.right) / 2
        : (rect.top + rect.bottom) / 2;
      const orthogonalStart = horizontal ? rect.top : rect.left;
      const orthogonalEnd = horizontal ? rect.bottom : rect.right;
      const orthogonalGap = sourceOrthogonal < orthogonalStart
        ? orthogonalStart - sourceOrthogonal
        : sourceOrthogonal > orthogonalEnd ? sourceOrthogonal - orthogonalEnd : 0;
      return { id: rect.id, index, primaryGap: sign * (primary - sourcePrimary), orthogonalGap };
    })
    .filter((candidate) => candidate.id !== sourceLeafId && candidate.primaryGap > 0)
    .sort((leftCandidate, rightCandidate) => (
      leftCandidate.primaryGap - rightCandidate.primaryGap
      || leftCandidate.orthogonalGap - rightCandidate.orthogonalGap
      || leftCandidate.index - rightCandidate.index
    ))[0]?.id ?? null;
}

function insertPaneBeside(
  tree: PaneNode,
  targetLeafId: string,
  pane: TerminalLeaf,
  side: PaneDropSide,
): PaneNode {
  const direction = side === 'left' || side === 'right' ? 'vertical' : 'horizontal';
  const before = side === 'left' || side === 'top';

  if (tree.type === 'leaf') {
    if (tree.id !== targetLeafId) return tree;
    return {
      id: genId('split'), type: 'split', direction,
      children: before ? [pane, tree] : [tree, pane], sizes: [1, 1],
    };
  }

  if (tree.direction === direction) {
    const targetIndex = tree.children.findIndex((child) => child.type === 'leaf' && child.id === targetLeafId);
    if (targetIndex >= 0) {
      const insertAt = before ? targetIndex : targetIndex + 1;
      const targetSize = tree.sizes[targetIndex] ?? 1;
      return {
        ...tree,
        children: [...tree.children.slice(0, insertAt), pane, ...tree.children.slice(insertAt)],
        sizes: [...tree.sizes.slice(0, targetIndex), targetSize / 2, targetSize / 2, ...tree.sizes.slice(targetIndex + 1)],
      };
    }
  }

  const children = tree.children.map((child) => insertPaneBeside(child, targetLeafId, pane, side));
  return children.some((child, index) => child !== tree.children[index]) ? { ...tree, children } : tree;
}

function reorderSiblingPane(
  tree: PaneNode,
  draggedLeafId: string,
  targetLeafId: string,
  side: PaneDropSide,
): PaneNode | null {
  if (tree.type === 'leaf') return null;
  const direction = side === 'left' || side === 'right' ? 'vertical' : 'horizontal';
  if (tree.direction === direction) {
    const draggedIndex = tree.children.findIndex(
      (child) => child.type === 'leaf' && child.id === draggedLeafId,
    );
    const targetIndex = tree.children.findIndex(
      (child) => child.type === 'leaf' && child.id === targetLeafId,
    );
    if (draggedIndex >= 0 && targetIndex >= 0) {
      const entries = tree.children.map((child, index) => ({
        child,
        size: tree.sizes[index] ?? 1,
      }));
      const [dragged] = entries.splice(draggedIndex, 1);
      const remainingTargetIndex = entries.findIndex(({ child }) => child.id === targetLeafId);
      const before = side === 'left' || side === 'top';
      entries.splice(before ? remainingTargetIndex : remainingTargetIndex + 1, 0, dragged);
      if (entries.every(({ child }, index) => child === tree.children[index])) return tree;
      return {
        ...tree,
        children: entries.map(({ child }) => child),
        sizes: entries.map(({ size }) => size),
      };
    }
  }
  for (let index = 0; index < tree.children.length; index += 1) {
    const moved = reorderSiblingPane(tree.children[index], draggedLeafId, targetLeafId, side);
    if (moved) {
      const children = [...tree.children];
      children[index] = moved;
      return { ...tree, children };
    }
  }
  return null;
}

/** Moves an existing terminal leaf beside another leaf without replacing either terminal. */
export function movePane(tree: PaneNode, draggedLeafId: string, targetLeafId: string, side: PaneDropSide): PaneNode {
  if (draggedLeafId === targetLeafId) return tree;
  const dragged = findLeaf(tree, draggedLeafId);
  if (!dragged || !findLeaf(tree, targetLeafId)) return tree;
  const reordered = reorderSiblingPane(tree, draggedLeafId, targetLeafId, side);
  if (reordered) return reordered;
  const withoutDragged = removePane(tree, draggedLeafId);
  return withoutDragged ? insertPaneBeside(withoutDragged, targetLeafId, dragged, side) : tree;
}

export function resizePane(
  tree: PaneNode,
  splitId: string,
  dividerIndex: number,
  leftFraction: number,
): PaneNode {
  if (tree.type === 'leaf') return tree;

  if (tree.id === splitId) {
    if (
      !Number.isInteger(dividerIndex)
      || dividerIndex < 0
      || dividerIndex >= tree.children.length - 1
      || !Number.isFinite(leftFraction)
    ) return tree;
    const nextSizes = tree.sizes.length === tree.children.length
      && tree.sizes.every((size) => Number.isFinite(size) && size > 0)
      ? [...tree.sizes]
      : tree.children.map(() => 1);
    const leftSize = nextSizes[dividerIndex];
    const rightSize = nextSizes[dividerIndex + 1];
    const pairTotal = leftSize + rightSize;
    const clamped = Math.max(0.1, Math.min(0.9, leftFraction));
    nextSizes[dividerIndex] = pairTotal * clamped;
    nextSizes[dividerIndex + 1] = pairTotal * (1 - clamped);
    return { ...tree, sizes: nextSizes };
  }

  const children = tree.children.map((child) => resizePane(child, splitId, dividerIndex, leftFraction));
  const changed = children.some((child, i) => child !== tree.children[i]);
  return changed ? { ...tree, children } : tree;
}

export function findLeaf(tree: PaneNode, leafId: string): TerminalLeaf | null {
  if (tree.type === 'leaf') {
    return tree.id === leafId ? tree : null;
  }
  for (const child of tree.children) {
    const found = findLeaf(child, leafId);
    if (found) return found;
  }
  return null;
}

export function getAllLeafIds(tree: PaneNode): string[] {
  if (tree.type === 'leaf') return [tree.id];
  return tree.children.flatMap(getAllLeafIds);
}

export function mapLeaves(tree: PaneNode, mapper: (leaf: TerminalLeaf) => TerminalLeaf): PaneNode {
  if (tree.type === 'leaf') return mapper(tree);
  return { ...tree, children: tree.children.map((child) => mapLeaves(child, mapper)) };
}

export function countLeaves(tree: PaneNode): number {
  if (tree.type === 'leaf') return 1;
  return tree.children.reduce((sum, c) => sum + countLeaves(c), 0);
}
