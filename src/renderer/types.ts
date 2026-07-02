export interface TerminalLeaf {
  id: string;
  type: 'leaf';
  title?: string;
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
}

export interface WorkspaceTabPreset {
  id: string;
  name: string;
  type: 'local' | 'ssh';
  cwd?: string;
  sshProfileId?: string;
  terminalCount: number;
  splitDirection: 'horizontal' | 'vertical';
}

let _counter = 0;
export function genId(prefix = 'p'): string {
  return `${prefix}-${++_counter}-${Date.now().toString(36)}`;
}

export function createLeaf(type: 'local' | 'ssh' = 'local'): TerminalLeaf {
  return { id: genId('term'), type: 'leaf', title: type === 'local' ? 'terminal' : 'ssh' };
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

export function countLeaves(tree: PaneNode): number {
  if (tree.type === 'leaf') return 1;
  return tree.children.reduce((sum, c) => sum + countLeaves(c), 0);
}
