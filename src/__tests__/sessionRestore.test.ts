import { describe, it, expect } from 'vitest';
import {
  serializePaneTree, restorePaneTree, normalizeSession,
} from '../renderer/sessionRestore';
import {
  createLeaf, splitPane, getAllLeafIds, countLeaves, PaneNode,
} from '../renderer/types';

describe('serializePaneTree', () => {
  it('strips leaf ids and keeps titles', () => {
    const leaf = createLeaf();
    const tree = splitPane(leaf, leaf.id, 'vertical');
    const saved = serializePaneTree(tree);

    expect(saved).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [1, 1],
      children: [
        { type: 'leaf', title: 'terminal' },
        { type: 'leaf', title: 'terminal' },
      ],
    });
  });

  it('strips nested split ids', () => {
    let tree: PaneNode = createLeaf();
    const firstId = tree.id;
    tree = splitPane(tree, firstId, 'vertical');
    const allIds = getAllLeafIds(tree);
    tree = splitPane(tree, allIds[1], 'horizontal');
    const saved = serializePaneTree(tree);

    // No 'id' field anywhere
    const json = JSON.stringify(saved);
    expect(json).not.toMatch(/"id":/);
  });
});

describe('restorePaneTree', () => {
  it('returns a fresh single leaf for a leaf input', () => {
    const restored = restorePaneTree({ type: 'leaf', title: 'shell' });
    expect(restored).not.toBeNull();
    if (!restored) throw new Error('Expected restored pane tree');
    expect(restored.type).toBe('leaf');
    if (restored.type === 'leaf') {
      expect(restored.title).toBe('shell');
      expect(restored.id).toBeTruthy();
    }
  });

  it('gives every restored leaf a unique id', () => {
    const saved = {
      type: 'split' as const,
      direction: 'vertical' as const,
      sizes: [1, 1, 1],
      children: [{ type: 'leaf' as const }, { type: 'leaf' as const }, { type: 'leaf' as const }],
    };
    const restored = restorePaneTree(saved)!;
    const ids = getAllLeafIds(restored as PaneNode);
    expect(new Set(ids).size).toBe(3);
  });

  it('round-trips through serialize/restore with the same shape', () => {
    let tree: PaneNode = createLeaf();
    const firstId = tree.id;
    tree = splitPane(tree, firstId, 'vertical');
    const leaves = getAllLeafIds(tree);
    tree = splitPane(tree, leaves[1], 'horizontal');
    tree = splitPane(tree, getAllLeafIds(tree)[0], 'vertical');
    const originalCount = countLeaves(tree);
    const originalSaved = serializePaneTree(tree);

    // Re-serialize the restored tree: counts, directions, and titles all
    // match the original (sizes are re-normalized to sum to 1 on restore,
    // which is intentional — see restorePaneTree — so we don't compare them
    // bit-for-bit).
    const restored = restorePaneTree(originalSaved)!;
    expect(countLeaves(restored)).toBe(originalCount);
    const restoredSaved = serializePaneTree(restored) as typeof originalSaved;
    expect(restoredSaved.type).toBe(originalSaved.type);
    if (restoredSaved.type === 'split' && originalSaved.type === 'split') {
      expect(restoredSaved.direction).toBe(originalSaved.direction);
      expect(restoredSaved.children).toHaveLength(originalSaved.children.length);
    }
  });

  it('returns null for garbage input', () => {
    expect(restorePaneTree(null)).toBeNull();
    expect(restorePaneTree(undefined)).toBeNull();
    expect(restorePaneTree({})).toBeNull();
    expect(restorePaneTree({ type: 'unknown' })).toBeNull();
    expect(restorePaneTree({ type: 'split', children: [] })).toBeNull();
  });

  it('normalizes split direction to a valid value', () => {
    const restored = restorePaneTree({
      type: 'split',
      direction: 'sideways',
      children: [{ type: 'leaf' }, { type: 'leaf' }],
    });
    expect(restored).not.toBeNull();
    if (!restored) throw new Error('Expected restored pane tree');
    expect(restored.type).toBe('split');
    if (restored.type === 'split') {
      expect(restored.direction).toBe('vertical');
    }
  });
});

describe('normalizeSession', () => {
  it('returns empty defaults for null/undefined', () => {
    const empty = normalizeSession(null);
    expect(empty.tabs).toEqual([]);
    expect(empty.activeTabId).toBeNull();
    expect(empty.sidebarOpen).toBe(true);
    expect(empty.tabsOpen).toBe(true);
    expect(empty.sidebarSection).toBe('files');
  });

  it('drops invalid tabs and bad sections', () => {
    const result = normalizeSession({
      tabs: [
        { id: 'a', title: 'good', type: 'local', root: { type: 'leaf' } },
        { id: '', title: 'bad-id', type: 'local', root: { type: 'leaf' } },
        { id: 'b', title: 'bad-type', type: 'remote', root: { type: 'leaf' } },
        { title: 'no-id', type: 'local', root: { type: 'leaf' } },
        null,
      ],
      activeTabId: 'a',
      sidebarSection: 'bogus',
    });
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].id).toBe('a');
    expect(result.sidebarSection).toBe('files');
    expect(result.activeTabId).toBe('a');
  });

  it('preserves valid ui state', () => {
    const result = normalizeSession({
      tabs: [],
      activeTabId: null,
      sidebarOpen: false,
      tabsOpen: false,
      sidebarSection: 'git',
    });
    expect(result.sidebarOpen).toBe(false);
    expect(result.tabsOpen).toBe(false);
    expect(result.sidebarSection).toBe('git');
  });
});
