import { describe, it, expect } from 'vitest';
import {
  serializePaneTree, restorePaneTree, normalizeSession,
} from '../../src/renderer/sessionRestore';
import {
  createLeaf, splitPane, getAllLeafIds, countLeaves, PaneNode,
} from '../../src/renderer/types';

describe('serializePaneTree', () => {
  it('includes startup automation only when explicitly requested', () => {
    const tree: PaneNode = {
      id: 'ssh-1',
      type: 'leaf',
      terminalType: 'ssh',
      sshProfileId: 'profile-1',
      startupCommands: [' hermes doctor ', 'hermes --tui'],
    };

    expect(serializePaneTree(tree)).not.toHaveProperty('startupCommands');
    expect(serializePaneTree(tree, {}, { includeStartupCommands: true })).toEqual({
      type: 'leaf',
      terminalType: 'ssh',
      sshProfileId: 'profile-1',
      startupCommands: ['hermes doctor', 'hermes --tui'],
      startupShellDialect: 'posix',
    });
  });

  it('keeps each local pane cwd in the portable tree', () => {
    const tree: PaneNode = {
      id: 'split-1',
      type: 'split',
      direction: 'vertical',
      sizes: [1, 1],
      children: [{ id: 'term-a', type: 'leaf' }, { id: 'term-b', type: 'leaf' }],
    };

    expect(serializePaneTree(tree, { 'term-a': 'C:/repo/api', 'term-b': 'C:/repo/web' })).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [0.5, 0.5],
      children: [
        { type: 'leaf', title: undefined, cwd: 'C:/repo/api' },
        { type: 'leaf', title: undefined, cwd: 'C:/repo/web' },
      ],
    });
  });

  it('strips leaf ids and keeps titles', () => {
    const leaf = createLeaf();
    const tree = splitPane(leaf, leaf.id, 'vertical');
    const saved = serializePaneTree(tree);

    expect(saved).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [0.5, 0.5],
      children: [
        { type: 'leaf', title: 'terminal', terminalType: 'local' },
        { type: 'leaf', title: 'terminal' },
      ],
    });
  });

  it('preserves terminal type and SSH profile per leaf', () => {
    const saved = serializePaneTree({
      id: 'split-1',
      type: 'split',
      direction: 'vertical',
      sizes: [1, 1],
      children: [
        { id: 'local-1', type: 'leaf', terminalType: 'local', cwd: 'C:/repo' },
        { id: 'ssh-1', type: 'leaf', terminalType: 'ssh', sshProfileId: 'profile-1' },
      ],
    });

    expect(saved).toEqual({
      type: 'split', direction: 'vertical', sizes: [0.5, 0.5],
      children: [
        { type: 'leaf', terminalType: 'local', cwd: 'C:/repo' },
        { type: 'leaf', terminalType: 'ssh', sshProfileId: 'profile-1' },
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
  it('fails malformed startup automation closed instead of skipping invalid rows', () => {
    const restored = restorePaneTree({
      type: 'leaf',
      terminalType: 'ssh',
      startupCommands: [' git pull ', '', 'npm\ninstall', 42],
    });

    expect(restored).toMatchObject({ type: 'leaf', terminalType: 'ssh' });
    expect(restored).not.toHaveProperty('startupCommands');
    expect(restored).not.toHaveProperty('startupShellDialect');
  });

  it('restores valid commands and defaults a missing SSH syntax to POSIX', () => {
    const restored = restorePaneTree({
      type: 'leaf',
      terminalType: 'ssh',
      startupCommands: [' git pull ', '', 'npm install'],
    });

    expect(restored).toMatchObject({
      type: 'leaf',
      terminalType: 'ssh',
      startupCommands: ['git pull', 'npm install'],
      startupShellDialect: 'posix',
    });
  });

  it('refuses SSH automation with an explicitly unsupported shell dialect', () => {
    const restored = restorePaneTree({
      type: 'leaf',
      terminalType: 'ssh',
      startupCommands: ['dangerous remote command'],
      startupShellDialect: 'cmd',
    });

    expect(restored).not.toHaveProperty('startupCommands');
    expect(restored).not.toHaveProperty('startupShellDialect');
  });

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

  it('round-trips nested layout ratios and terminal working directories', () => {
    const saved = {
      type: 'split' as const,
      direction: 'vertical' as const,
      sizes: [3, 7],
      children: [
        { type: 'leaf' as const, title: 'api', cwd: 'C:/repo/api' },
        {
          type: 'split' as const,
          direction: 'horizontal' as const,
          sizes: [1, 3],
          children: [
            { type: 'leaf' as const, title: 'web', cwd: 'C:/repo/web' },
            { type: 'leaf' as const, title: 'worker', cwd: 'C:/repo/worker' },
          ],
        },
      ],
    };

    const restored = restorePaneTree(saved)!;
    expect(countLeaves(restored)).toBe(3);
    expect(serializePaneTree(restored)).toEqual({
      type: 'split',
      direction: 'vertical',
      sizes: [0.3, 0.7],
      children: [
        { type: 'leaf', title: 'api', cwd: 'C:/repo/api' },
        {
          type: 'split',
          direction: 'horizontal',
          sizes: [0.25, 0.75],
          children: [
            { type: 'leaf', title: 'web', cwd: 'C:/repo/web' },
            { type: 'leaf', title: 'worker', cwd: 'C:/repo/worker' },
          ],
        },
      ],
    });
  });

  it('falls back to equal sizes for older presets without valid layout sizes', () => {
    const restored = restorePaneTree({
      type: 'split', direction: 'vertical', sizes: [1],
      children: [{ type: 'leaf' }, { type: 'leaf' }],
    });

    expect(restored).toMatchObject({ type: 'split', sizes: [0.5, 0.5] });
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
