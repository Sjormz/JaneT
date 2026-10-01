import { describe, expect, it } from 'vitest';
import { migrateSessionsToProjects, type MigratableTab, type MigrationPaneLeaf, type MigrationPaneNode } from '../../src/shared/sessionMigration';
import type { WorkspaceGroup } from '../../src/shared/workspaceGroups';

const work: WorkspaceGroup = { id: 'work', name: 'Work', directory: 'C:/Work' };
const library: WorkspaceGroup = { id: 'library', name: 'Repo', kind: 'folder', directory: 'C:/Repo' };

const leaf = (cwd?: string, extra: Partial<MigrationPaneLeaf> = {}): MigrationPaneLeaf => ({ type: 'leaf', ...(cwd ? { cwd } : {}), ...extra });
const split = (...children: MigrationPaneNode[]): MigrationPaneNode => ({
  type: 'split', direction: 'vertical', sizes: children.map(() => 1 / children.length), children,
});
const empty = (): MigrationPaneNode => ({ type: 'split', direction: 'vertical', sizes: [], children: [] });
const leaves = (node: MigrationPaneNode): MigrationPaneLeaf[] => node.type === 'leaf' ? [node] : node.children.flatMap(leaves);
const tab = (id: string, groupId: string, cwd: string | undefined, isProject: boolean | undefined, root: MigrationPaneNode): MigratableTab => ({
  id, title: id, groupId, ...(cwd ? { cwd } : {}), ...(isProject === undefined ? {} : { isProject }), root,
});

function migrate(tabs: MigratableTab[], groups: WorkspaceGroup[] = [work, library], activeTabId: string | null = null,
  isLinkedWorktree?: (directory: string) => boolean) {
  return migrateSessionsToProjects({ tabs, groups, activeTabId }, { isLinkedWorktree });
}

describe('migrating saved sessions into projects', () => {
  it('merges a session into the project whose folder equals its folder, keeping each terminal', () => {
    const result = migrate([
      tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))),
      tab('api', 'work', 'C:/Work/Api', true, split(leaf('C:/Work/Api'))),
      tab('watch', 'work', 'c:\\work\\api\\', false, split(
        leaf(undefined, { title: 'build watcher', startupCommands: ['npm run watch'], startupShellDialect: 'powershell' }),
        leaf('C:/Work/Api/docs', { title: 'docs' }),
      )),
    ]);
    expect(result.tabs.map((entry) => [entry.id, entry.isProject])).toEqual([['app', true], ['api', true]]);
    expect(leaves(result.tabs[1].root)).toEqual([
      { type: 'leaf', cwd: 'C:/Work/Api' },
      // A terminal without its own folder keeps the session's folder.
      { type: 'leaf', cwd: 'c:\\work\\api\\', title: 'build watcher', startupCommands: ['npm run watch'], startupShellDialect: 'powershell' },
      { type: 'leaf', cwd: 'C:/Work/Api/docs', title: 'docs' },
    ]);
    expect(leaves(result.tabs[0].root)).toHaveLength(1);
  });

  it('prefers the deepest project folder containing the session, else the first project', () => {
    const result = migrate([
      tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))),
      tab('nested', 'work', 'C:/Work/App/packages/ui', true, split(leaf())),
      tab('in-ui', 'work', 'C:/Work/App/packages/ui/src', false, split(leaf())),
      tab('elsewhere', 'work', 'D:/Scratch', false, split(leaf())),
    ]);
    expect(result.tabs.map((entry) => [entry.id, leaves(entry.root).map((item) => item.cwd)])).toEqual([
      ['app', ['C:/Work/App', 'D:/Scratch']],
      ['nested', [undefined, 'C:/Work/App/packages/ui/src']],
    ]);
  });

  it('keeps an empty project layout as the merged session layout', () => {
    const sessionRoot = { type: 'split' as const, direction: 'horizontal' as const, sizes: [0.25, 0.75], children: [leaf('C:/Repo'), leaf('C:/Repo/src')] };
    const result = migrate([
      tab('repo', 'library', 'C:/Repo', true, empty()),
      tab('terminal-2', 'library', 'C:/Repo', false, sessionRoot),
    ]);
    expect(result.tabs).toEqual([{ ...tab('repo', 'library', 'C:/Repo', true, sessionRoot) }]);
  });

  it('turns the first session of a Library entry without projects into its project', () => {
    const result = migrate([
      tab('one', 'library', 'C:/Repo', false, split(leaf('C:/Repo'))),
      tab('two', 'library', 'C:/Repo/src', false, split(leaf('C:/Repo/src'))),
    ]);
    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0]).toMatchObject({ id: 'one', isProject: true, cwd: 'C:/Repo' });
    expect(leaves(result.tabs[0].root).map((item) => item.cwd)).toEqual(['C:/Repo', 'C:/Repo/src']);
  });

  it('in a Workspace without projects, a direct child folder session becomes that folder\'s project', () => {
    const result = migrate([tab('app', 'work', 'C:/Work/App', false, split(leaf()))]);
    expect(result.tabs).toEqual([{ ...tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))), root: split(leaf()) }]);
  });

  it('in a Workspace without projects, keeps other sessions with terminals as projects that own no folder and drops empty ones', () => {
    const result = migrate([
      tab('root-shell', 'work', 'C:/Work', false, split(leaf('C:/Work'))),
      tab('empty', 'other', undefined, false, empty()),
    ], [work, { id: 'other', name: 'Other', directory: 'C:/Other' }]);
    expect(result.tabs.map((entry) => [entry.id, entry.isProject, entry.cwd])).toEqual([['root-shell', true, 'C:/Work']]);
  });

  it('migrates sessions saved explicitly by v0.14.1 and legacy unflagged tabs alike', () => {
    const result = migrate([
      tab('legacy-project', 'work', 'C:/Work/App', undefined, split(leaf('C:/Work/App'))),
      tab('legacy-session', 'work', 'C:/Work/App', undefined, split(leaf('C:/Work/App'))),
      tab('explicit-session', 'work', 'C:/Work/App', false, split(leaf('C:/Work/App/src'))),
    ]);
    expect(result.tabs.map((entry) => [entry.id, entry.isProject, leaves(entry.root).length])).toEqual([['legacy-project', true, 3]]);
  });

  it('is idempotent and leaves projects-only sessions untouched', () => {
    const tabs = [
      tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))),
      tab('session', 'work', 'C:/Work/App', false, split(leaf('C:/Work/App'))),
    ];
    const once = migrate(tabs, [work], 'session');
    const twice = migrate(once.tabs, once.groups, once.activeTabId);
    expect(twice).toEqual(once);
    const projectsOnly = migrate(once.tabs, once.groups, once.activeTabId);
    expect(projectsOnly.tabs[0]).toBe(once.tabs[0]);
  });

  it('selects the merged terminal when the active entry was a session', () => {
    const result = migrate([
      { ...tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'), leaf('C:/Work/App'))), maximizedPanePath: [1] },
      { ...tab('session', 'work', 'C:/Work/App', false, split(leaf('C:/Work/App/a'), leaf('C:/Work/App/b'))), selectedPanePath: [1] },
    ], [work], 'session');
    expect(result.activeTabId).toBe('app');
    const project = result.tabs[0];
    expect(project.maximizedPanePath).toBeUndefined();
    let node: MigrationPaneNode = project.root;
    for (const index of project.selectedPanePath!) node = (node as Extract<MigrationPaneNode, { type: 'split' }>).children[index];
    expect(node).toMatchObject({ cwd: 'C:/Work/App/b' });
  });

  it('keeps the project selection and maximized pane when a background session merges', () => {
    const result = migrate([
      { ...tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App/x'), leaf('C:/Work/App/y'))), selectedPanePath: [1], maximizedPanePath: [1] },
      tab('session', 'work', 'C:/Work/App', false, split(leaf('C:/Work/App/z'))),
    ], [work], 'app');
    const project = result.tabs[0];
    expect(project.selectedPanePath).toEqual(project.maximizedPanePath);
    let node: MigrationPaneNode = project.root;
    for (const index of project.maximizedPanePath!) node = (node as Extract<MigrationPaneNode, { type: 'split' }>).children[index];
    expect(node).toMatchObject({ cwd: 'C:/Work/App/y' });
  });

  it('keeps the project terminals first and drops terminals beyond the 64-terminal limit in reading order', () => {
    const many = (count: number, prefix: string) => split(...Array.from({ length: count }, (_, index) => leaf(`${prefix}/${index}`)));
    const result = migrate([
      tab('app', 'work', 'C:/Work/App', true, many(40, 'C:/Work/App/p')),
      tab('session', 'work', 'C:/Work/App', false, many(30, 'C:/Work/App/s')),
    ], [work]);
    const merged = leaves(result.tabs[0].root).map((item) => item.cwd);
    expect(merged).toHaveLength(64);
    expect(merged.slice(0, 40)).toEqual(Array.from({ length: 40 }, (_, index) => `C:/Work/App/p/${index}`));
    expect(merged.slice(40)).toEqual(Array.from({ length: 24 }, (_, index) => `C:/Work/App/s/${index}`));
  });

  it('turns a recognized worktree session in a Library entry into that entry\'s worktree project', () => {
    const isWorktree = (directory: string) => directory === 'C:/Repo-feature';
    const result = migrate([
      tab('repo', 'library', 'C:/Repo', true, split(leaf('C:/Repo'))),
      tab('feature', 'library', 'C:/Repo-feature', false, split(leaf('C:/Repo-feature'))),
      tab('feature-2', 'library', 'C:/Repo-feature', false, split(leaf('C:/Repo-feature/src'))),
    ], [library], null, isWorktree);
    expect(result.groups).toEqual([library]);
    expect(result.tabs.map((entry) => [entry.id, entry.groupId, entry.cwd, leaves(entry.root).length])).toEqual([
      ['repo', 'library', 'C:/Repo', 1],
      ['feature', 'library', 'C:/Repo-feature', 2],
    ]);
  });

  it('moves a recognized worktree session of a Workspace project into its own Library entry', () => {
    const isWorktree = (directory: string) => directory === 'C:/Work/App-feature';
    const result = migrate([
      tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))),
      tab('feature', 'work', 'C:/Work/App-feature', false, split(leaf('C:/Work/App-feature'))),
    ], [work], 'feature', isWorktree);
    expect(result.groups).toEqual([work, { id: 'folder-feature', name: 'App-feature', kind: 'folder', directory: 'C:/Work/App-feature' }]);
    expect(result.tabs).toEqual([
      tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))),
      tab('feature', 'folder-feature', 'C:/Work/App-feature', true, split(leaf('C:/Work/App-feature'))),
    ]);
    expect(result.activeTabId).toBe('feature');
    expect(migrate(result.tabs, result.groups, result.activeTabId, isWorktree)).toEqual(result);
  });

  it('merges a worktree session like any other when Library is full', () => {
    const groups = [work, ...Array.from({ length: 63 }, (_, index) => ({ id: `g${index}`, name: `G${index}` }))];
    const result = migrate([
      tab('app', 'work', 'C:/Work/App', true, split(leaf('C:/Work/App'))),
      tab('feature', 'work', 'C:/Work/App-feature', false, split(leaf('C:/Work/App-feature'))),
    ], groups, null, () => true);
    expect(result.groups).toHaveLength(64);
    expect(result.tabs.map((entry) => [entry.id, leaves(entry.root).length])).toEqual([['app', 2]]);
  });
});
