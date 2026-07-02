import { PaneNode, TerminalLeaf, SplitNode, genId } from './types';

export interface SavedPaneLeaf {
  type: 'leaf';
  title?: string;
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

/** Strip runtime-only ids and emit a portable, JSON-safe tree. */
export function serializePaneTree(node: PaneNode): SavedPaneNode {
  if (node.type === 'leaf') {
    return { type: 'leaf', title: node.title };
  }
  return {
    type: 'split',
    direction: node.direction,
    sizes: [...node.sizes],
    children: node.children.map(serializePaneTree),
  };
}

/**
 * Recreate a PaneNode tree with fresh leaf ids, keeping shape
 * (direction, sizes, child count, leaf titles). Returns null if the
 * input is structurally invalid so a corrupt session silently falls
 * back to a single fresh leaf instead of crashing the app.
 */
export function restorePaneTree(saved: unknown, prefix: 'term' | 'split' = 'term'): PaneNode | null {
  if (!saved || typeof saved !== 'object') return null;
  const node = saved as { type?: string; title?: string; direction?: string; sizes?: unknown; children?: unknown };

  if (node.type === 'leaf') {
    const leaf: TerminalLeaf = {
      id: genId(prefix),
      type: 'leaf',
      title: typeof node.title === 'string' ? node.title : undefined,
    };
    return leaf;
  }

  if (node.type === 'split') {
    const direction = node.direction === 'horizontal' ? 'horizontal' : 'vertical';
    if (!Array.isArray(node.children) || node.children.length === 0) return null;

    const children: PaneNode[] = [];
    for (const child of node.children) {
      const restored = restorePaneTree(child, prefix);
      if (restored) children.push(restored);
    }
    if (children.length === 0) return null;

    // Rebuild sizes so they line up with the actual child list and sum to 1.
    const total = children.length;
    const sizes = new Array<number>(total).fill(1 / total);

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

  const tabs = Array.isArray(obj.tabs) ? obj.tabs.filter(isValidSavedTab) : [];

  return {
    tabs,
    activeTabId: typeof obj.activeTabId === 'string' ? obj.activeTabId : null,
    sidebarOpen: obj.sidebarOpen !== false,
    tabsOpen: obj.tabsOpen !== false,
    sidebarSection: section,
  };
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
