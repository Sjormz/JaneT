// Pane tree types for split panes

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
  sizes: number[]; // flex ratios (e.g. [1, 1] for equal)
}

export type PaneNode = TerminalLeaf | SplitNode;

export interface TabInfo {
  id: string;
  title: string;
  type: 'local' | 'ssh';
  sshSessionId?: string;
  root: PaneNode;
}

export interface SessionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
}

// === Tree manipulation helpers ===

// Generate unique IDs
let _counter = 0;
export function genId(prefix = 'p'): string {
  return `${prefix}-${++_counter}-${Date.now().toString(36)}`;
}

// Create a new leaf terminal
export function createLeaf(type: 'local' | 'ssh' = 'local'): TerminalLeaf {
  return { id: genId('term'), type: 'leaf', title: type === 'local' ? 'terminal' : 'ssh' };
}

// Split a pane at a specific leaf: replace the leaf with a SplitNode
// that contains the original leaf and a new leaf
export function splitPane(
  tree: PaneNode,
  targetLeafId: string,
  direction: 'horizontal' | 'vertical',
): PaneNode {
  if (tree.type === 'leaf') {
    if (tree.id === targetLeafId) {
      // Found the target — replace with SplitNode
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
    return tree; // not the target, no change
  }

  // Special-case a single-child split root so splitting its lone leaf
  // keeps the terminal mounted instead of nesting a new split node
  // underneath the existing wrapper.
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

  // If the target leaf is already a direct child of a split running in the
  // requested direction, insert the new pane beside it instead of wrapping the
  // existing leaf in a nested split. Keeping the leaf at the same React tree
  // level preserves the mounted TerminalPane/xterm DOM and avoids the visual
  // flicker that looked like a terminal restart.
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

  // It's a SplitNode — recurse into children
  const newChildren = tree.children.map((child) => splitPane(child, targetLeafId, direction));
  const changed = newChildren.some((child, i) => child !== tree.children[i]);
  if (!changed) return tree;

  return { ...tree, children: newChildren };
}

// Remove a leaf from the tree. Returns the new tree or null if empty.
export function removePane(tree: PaneNode, targetLeafId: string): PaneNode | null {
  if (tree.type === 'leaf') {
    return tree.id === targetLeafId ? null : tree;
  }

  // Filter out the target, then collapse if needed
  const remaining = tree.children
    .map((child) => removePane(child, targetLeafId))
    .filter((child): child is PaneNode => child !== null);

  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0]; // collapse split → leaf

  // Rebalance sizes
  const removedIndex = tree.children.findIndex(
    (child) => findLeaf(child, targetLeafId) !== null,
  );
  let newSizes: number[];
  if (removedIndex >= 0) {
    newSizes = tree.sizes.filter((_, i) => {
      // Keep only sizes of remaining children
      const child = tree.children[i];
      if (child.type === 'leaf' && child.id === targetLeafId) return false;
      if (findLeaf(child, targetLeafId) !== null) return false;
      return true;
    });
  } else {
    newSizes = tree.sizes.slice(0, remaining.length);
  }

  // Normalise sizes so they sum proportionally
  const total = newSizes.reduce((a, b) => a + b, 0);
  if (total > 0) {
    newSizes = newSizes.map((s) => s / total);
  } else {
    newSizes = remaining.map(() => 1);
  }

  return { ...tree, children: remaining, sizes: newSizes };
}

// Find a leaf by ID (returns the leaf or null)
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

// Get all leaf IDs in the tree
export function getAllLeafIds(tree: PaneNode): string[] {
  if (tree.type === 'leaf') return [tree.id];
  return tree.children.flatMap(getAllLeafIds);
}

// Get the count of leaves in the tree
export function countLeaves(tree: PaneNode): number {
  if (tree.type === 'leaf') return 1;
  return tree.children.reduce((sum, c) => sum + countLeaves(c), 0);
}
