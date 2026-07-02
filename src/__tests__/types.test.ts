import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLeaf, splitPane, removePane, findLeaf,
  getAllLeafIds, countLeaves, genId, PaneNode,
} from '../renderer/types';

// Reset the counter between tests so IDs are predictable
beforeEach(() => {
  // genId uses a module-level counter we can't easily reset.
  // We just test structural properties rather than exact IDs.
});

describe('createLeaf', () => {
  it('creates a leaf with type leaf', () => {
    const leaf = createLeaf();
    expect(leaf.type).toBe('leaf');
  });

  it('creates a leaf with a valid id', () => {
    const leaf = createLeaf();
    expect(leaf.id).toBeTruthy();
    expect(leaf.id.startsWith('term-')).toBe(true);
  });

  it('creates unique ids for consecutive calls', () => {
    const a = createLeaf();
    const b = createLeaf();
    expect(a.id).not.toBe(b.id);
  });
});

describe('splitPane', () => {
  it('splits a single leaf into a vertical split', () => {
    const leaf = createLeaf();
    const result = splitPane(leaf, leaf.id, 'vertical');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('vertical');
      expect(result.children.length).toBe(2);
      expect(result.sizes).toEqual([1, 1]);
      expect(result.children[0].id).toBe(leaf.id); // original preserved
      expect(result.children[1].type).toBe('leaf'); // new leaf
    }
  });

  it('splits a single leaf into a horizontal split', () => {
    const leaf = createLeaf();
    const result = splitPane(leaf, leaf.id, 'horizontal');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal');
      expect(result.children.length).toBe(2);
    }
  });

  it('splits a single-child split root without nesting a new split', () => {
    const leaf = createLeaf();
    const tree: PaneNode = {
      id: 'split-root', type: 'split', direction: 'vertical',
      children: [leaf], sizes: [1],
    };

    const result = splitPane(tree, leaf.id, 'horizontal');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.children).toHaveLength(2);
      expect(result.direction).toBe('horizontal');
      expect(result.children[0].id).toBe(leaf.id);
      expect(result.children[1].type).toBe('leaf');
      expect(result.sizes).toEqual([1, 1]);
    }
  });

  it('splits a direct child on the same axis without wrapping the existing leaf', () => {
    const leafA = createLeaf();
    const leafB = createLeaf();
    const tree: PaneNode = {
      id: 'split1', type: 'split', direction: 'vertical',
      children: [leafA, leafB], sizes: [1, 1],
    };

    const result = splitPane(tree, leafB.id, 'vertical');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.children).toHaveLength(3);
      expect(result.children[0]).toBe(leafA);
      expect(result.children[1]).toBe(leafB);
      expect(result.children[2].type).toBe('leaf');
      expect(result.children[2].id).not.toBe(leafB.id);
      expect(result.sizes).toEqual([1, 1, 1]);
    }
  });

  it('splits a leaf nested inside a split tree', () => {
    // Create a tree: split -> [leafA, leafB]
    const leafA = createLeaf();
    const leafB = createLeaf();
    const tree: PaneNode = {
      id: 'split1', type: 'split', direction: 'vertical',
      children: [leafA, leafB], sizes: [1, 1],
    };

    // Split leafA
    const result = splitPane(tree, leafA.id, 'horizontal');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.children.length).toBe(2);

      // First child should now be a split (leafA + new leaf)
      const firstChild = result.children[0];
      expect(firstChild.type).toBe('split');
      if (firstChild.type === 'split') {
        expect(firstChild.children.length).toBe(2);
        expect(firstChild.children[0].id).toBe(leafA.id);
        expect(firstChild.direction).toBe('horizontal');
      }

      // Second child should still be leafB
      expect(result.children[1].id).toBe(leafB.id);
    }
  });

  it('does nothing if target leaf is not found', () => {
    const leaf = createLeaf();
    const result = splitPane(leaf, 'nonexistent-id', 'vertical');
    expect(result).toBe(leaf); // same reference
  });

  it('creates independent new leaf ids on each split', () => {
    const leaf = createLeaf();
    const result = splitPane(leaf, leaf.id, 'vertical');
    if (result.type === 'split') {
      const originalId = result.children[0].id;
      const newLeafId = result.children[1].id;
      expect(originalId).not.toBe(newLeafId);
    }
  });
});

describe('removePane', () => {
  it('removes a leaf and returns null if only child', () => {
    const leaf = createLeaf();
    const result = removePane(leaf, leaf.id);
    expect(result).toBeNull();
  });

  it('removes a leaf from a split and collapses', () => {
    // Tree: split -> [leafA, leafB]
    const leafA = createLeaf();
    const leafB = createLeaf();
    const tree: PaneNode = {
      id: 'split1', type: 'split', direction: 'vertical',
      children: [leafA, leafB], sizes: [1, 1],
    };

    // Remove leafA
    const result = removePane(tree, leafA.id);
    // Should collapse to just leafB
    expect(result).not.toBeNull();
    expect(result!.type).toBe('leaf');
    if (result && result.type === 'leaf') {
      expect(result.id).toBe(leafB.id);
    }
  });

  it('removes a leaf from a 3-child split without collapsing', () => {
    const leafA = createLeaf();
    const leafB = createLeaf();
    const leafC = createLeaf();
    const tree: PaneNode = {
      id: 'split1', type: 'split', direction: 'vertical',
      children: [leafA, leafB, leafC], sizes: [1, 1, 1],
    };

    // Remove leafB
    const result = removePane(tree, leafB.id);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('split');
    if (result && result.type === 'split') {
      expect(result.children.length).toBe(2);
      expect(result.children[0].id).toBe(leafA.id);
      expect(result.children[1].id).toBe(leafC.id);
      // Sizes should be re-normalised
      expect(result.sizes.length).toBe(2);
      expect(result.sizes[0] + result.sizes[1]).toBeCloseTo(1);
    }
  });

  it('removes a deeply nested leaf', () => {
    // Tree: splitV -> [leafA, splitH -> [leafB, leafC]]
    const leafA = createLeaf();
    const leafB = createLeaf();
    const leafC = createLeaf();
    const innerSplit: PaneNode = {
      id: 'inner', type: 'split', direction: 'horizontal',
      children: [leafB, leafC], sizes: [1, 1],
    };
    const tree: PaneNode = {
      id: 'outer', type: 'split', direction: 'vertical',
      children: [leafA, innerSplit], sizes: [1, 1],
    };

    // Remove leafB from inner split
    const result = removePane(tree, leafB.id);
    expect(result).not.toBeNull();
    // The inner split should collapse, leaving just leafC as a direct child of outer
    if (result && result.type === 'split') {
      expect(result.children.length).toBe(2);
      expect(result.children[0].id).toBe(leafA.id);
      expect(result.children[1].id).toBe(leafC.id);
    }
  });

  it('does nothing if target leaf not found', () => {
    const leaf = createLeaf();
    const result = removePane(leaf, 'nonexistent');
    expect(result).toBe(leaf);
  });
});

describe('findLeaf', () => {
  it('finds a leaf in a flat tree', () => {
    const leaf = createLeaf();
    const found = findLeaf(leaf, leaf.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(leaf.id);
  });

  it('finds a leaf in a nested tree', () => {
    const leafA = createLeaf();
    const leafB = createLeaf();
    const leafC = createLeaf();
    const tree: PaneNode = {
      id: 'outer', type: 'split', direction: 'vertical',
      children: [
        leafA,
        { id: 'inner', type: 'split', direction: 'horizontal',
          children: [leafB, leafC], sizes: [1, 1] },
      ],
      sizes: [1, 1],
    };

    expect(findLeaf(tree, leafC.id)!.id).toBe(leafC.id);
    expect(findLeaf(tree, leafA.id)!.id).toBe(leafA.id);
  });

  it('returns null for nonexistent leaf', () => {
    const leaf = createLeaf();
    expect(findLeaf(leaf, 'nope')).toBeNull();
  });
});

describe('getAllLeafIds', () => {
  it('returns single id for a leaf', () => {
    const leaf = createLeaf();
    expect(getAllLeafIds(leaf)).toEqual([leaf.id]);
  });

  it('returns all leaf ids in a nested tree', () => {
    const leafA = createLeaf();
    const leafB = createLeaf();
    const leafC = createLeaf();
    const tree: PaneNode = {
      id: 'outer', type: 'split', direction: 'vertical',
      children: [
        leafA,
        { id: 'inner', type: 'split', direction: 'horizontal',
          children: [leafB, leafC], sizes: [1, 1] },
      ],
      sizes: [1, 1],
    };

    const ids = getAllLeafIds(tree);
    expect(ids).toContain(leafA.id);
    expect(ids).toContain(leafB.id);
    expect(ids).toContain(leafC.id);
    expect(ids.length).toBe(3);
  });
});

describe('countLeaves', () => {
  it('returns 1 for a single leaf', () => {
    expect(countLeaves(createLeaf())).toBe(1);
  });

  it('counts all leaves in a nested tree', () => {
    const leafA = createLeaf();
    const leafB = createLeaf();
    const leafC = createLeaf();
    const leafD = createLeaf();
    const tree: PaneNode = {
      id: 'outer', type: 'split', direction: 'vertical',
      children: [
        leafA,
        { id: 'm1', type: 'split', direction: 'horizontal',
          children: [
            leafB,
            { id: 'm2', type: 'split', direction: 'vertical',
              children: [leafC, leafD], sizes: [1, 1] },
          ], sizes: [1, 1] },
      ], sizes: [1, 1],
    };

    expect(countLeaves(tree)).toBe(4);
  });
});

describe('Integration: split then remove', () => {
  it('split and remove restores original state', () => {
    const leaf = createLeaf();
    // Split
    const splitResult = splitPane(leaf, leaf.id, 'vertical');
    expect(countLeaves(splitResult)).toBe(2);

    // Get the new leaf's id
    if (splitResult.type === 'split') {
      const newLeafId = splitResult.children[1].id;

      // Remove the original leaf
      const afterRemove = removePane(splitResult, leaf.id);
      expect(afterRemove).not.toBeNull();
      expect(afterRemove!.type).toBe('leaf');
      if (afterRemove && afterRemove.type === 'leaf') {
        expect(afterRemove.id).toBe(newLeafId);
      }
    }
  });

  it('can split multiple times and count grows correctly', () => {
    let tree: PaneNode = createLeaf();
    const firstLeafId = tree.id;

    // Split 3 times
    tree = splitPane(tree, firstLeafId, 'vertical');
    expect(countLeaves(tree)).toBe(2);

    // Find a leaf to split further
    const allIds = getAllLeafIds(tree);
    tree = splitPane(tree, allIds[1], 'horizontal');
    expect(countLeaves(tree)).toBe(3);

    const allIds2 = getAllLeafIds(tree);
    tree = splitPane(tree, allIds2[0], 'vertical');
    expect(countLeaves(tree)).toBe(4);
  });
});
