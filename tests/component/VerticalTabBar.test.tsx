import { describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VerticalTabBar from '../../src/renderer/components/VerticalTabBar';
import { TabInfo, WorkspaceTabPreset } from '../../src/renderer/types';
import type { AgentStatus } from '../../src/renderer/terminalAwareness';

const tabs: TabInfo[] = [
  {
    id: 'tab-1', title: 'Main app', type: 'local', cwd: 'C:/repo',
    root: { id: 'split-1', type: 'split', direction: 'vertical', children: [{ id: 'term-1', type: 'leaf' }], sizes: [1] },
  },
  {
    id: 'tab-2', title: 'Tools', type: 'local',
    root: { id: 'split-2', type: 'split', direction: 'vertical', children: [{ id: 'term-2', type: 'leaf' }], sizes: [1] },
  },
];

const groups = [{ id: 'default', name: 'My workspaces' }, { id: 'clients', name: 'Clients' }];
function renderTabs(overrides?: Partial<React.ComponentProps<typeof VerticalTabBar>>) {
  function Harness() {
    const [creatorOpen, onCreatorOpenChange] = useState(false);
    const [currentGroups, onGroupsChange] = useState(groups);
    return <VerticalTabBar
      mainDirectory="C:/Work"
      tabs={tabs} activeTabId="tab-1"
      groups={currentGroups} onGroupsChange={onGroupsChange}
      creatorOpen={creatorOpen} onCreatorOpenChange={onCreatorOpenChange}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()}
      onWorkspaceTabLaunch={vi.fn().mockResolvedValue(undefined)}
      onRenameTab={vi.fn()} onCollapse={vi.fn()} {...overrides} />;
  }
  return render(<Harness />);
}

describe('VerticalTabBar', () => {
  it('marks linked worktree projects beneath their names, excluding the main checkout', async () => {
    Object.defineProperty(window, 'janet', { configurable: true, value: { gitWorktrees: vi.fn().mockResolvedValue([
      { path: 'C:/repo', bare: false, detached: false, head: 'main' },
      { path: 'C:/repo-feature', bare: false, detached: false, head: 'feature' },
    ]) } });
    renderTabs({ tabs: [tabs[0], { ...tabs[0], id: 'feature', title: 'Feature', cwd: 'C:\\repo-feature\\src', isProject: true }] });
    const badge = await screen.findByRole('img', { name: 'Worktree project' });
    expect(badge.parentElement).toHaveTextContent('Feature');
    expect(screen.getAllByRole('img', { name: 'Worktree project' })).toHaveLength(1);
  });

  it('removes a virtual Library project without offering folder deletion', () => {
    const action = vi.fn();
    renderTabs({ groups: [{ id: 'library', name: 'Repo', kind: 'folder', directory: 'C:/repo' }],
      tabs: [{ ...tabs[0], groupId: 'library', isProject: true }], onWorkspaceAction: action });
    fireEvent.contextMenu(screen.getByRole('button', { name: /Main app Local/ }));
    expect(screen.queryByRole('menuitem', { name: 'Delete project…' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove project…' }));
    expect(action).toHaveBeenCalledWith('unlink', 'library', 'tab-1');
  });
  it('uses the newly clicked parent when switching project creation between entries', async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    renderTabs({ groups: [
      { id: 'work', name: 'Work', directory: '/work' },
      { id: 'library', name: 'Library parent', directory: '/repos', kind: 'folder' },
    ], onWorkspaceTabLaunch: launch });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Work' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Test' } });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Library parent' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test' }), expect.objectContaining({ id: 'library' })));
  });
  it.each([undefined, 'folder'] as const)('creates projects from their parent context menu (%s)', async kind => {
    const launch = vi.fn().mockResolvedValue(undefined);
    renderTabs({ groups: [{ id: 'parent', name: 'Parent', directory: '/parent', kind }], onWorkspaceTabLaunch: launch });
    expect(screen.queryByRole('button', { name: /Add project to/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Parent' }), { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Child' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Child', createProject: true, terminalCount: 0 }), expect.objectContaining({ id: 'parent', kind })));
    expect(screen.queryByRole('button', { name: /Add project to/ })).not.toBeInTheDocument();
  });
  it('creates a project without terminals by default', () => {
    const launch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch: launch });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My workspaces' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Later' } });
    expect(screen.getByRole('button', { name: /Add terminals/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Later', terminalCount: 0,
      root: { type: 'split', direction: 'vertical', children: [], sizes: [] },
    }), expect.anything());
  });
  it('opens setup instead of creating a workspace when no main directory is set', () => {
    const groupsChanged = vi.fn();
    renderTabs({ mainDirectory: null, groups: [], onGroupsChange: groupsChanged });
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    expect(screen.getByRole('dialog', { name: 'Main directory settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument();
    expect(groupsChanged).not.toHaveBeenCalled();
  });
  it('removes legacy workspace entries without requesting directory deletion', () => {
    const action = vi.fn();
    renderTabs({ onWorkspaceAction: action });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^My workspaces/, expanded: true }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove workspace…' }));
    expect(action).toHaveBeenCalledWith('unlink', 'default');
  });
  it('offers close for a root session, including an empty session left by an older version', () => {
    const close = vi.fn();
    renderTabs({ groups: [{ id: 'work', name: 'Work', directory: 'C:/Work' }],
      tabs: [{ ...tabs[0], groupId: 'work', cwd: 'C:/Work', root: { id: 'empty', type: 'split', direction: 'vertical', children: [], sizes: [] } }], onCloseTab: close });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Main app/ }));
    expect(screen.queryByRole('menuitem', { name: 'Delete project…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Close all terminals…' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close session' }));
    expect(close).toHaveBeenCalledWith('tab-1');
  });
  it('opens the project form for an empty-state destination request', async () => {
    const handled = vi.fn();
    renderTabs({ creatorOpen: true, entryRequest: { action: 'create', groupId: 'clients' }, onEntryRequestHandled: handled });
    expect(await screen.findByRole('heading', { name: 'Create project' })).toBeInTheDocument();
    expect(handled).toHaveBeenCalled();
  });
  it('opens a Library project form for an empty-state destination request', async () => {
    renderTabs({ groups: [{ id: 'repo', name: 'JaneT', kind: 'folder', directory: 'C:/repo' }], creatorOpen: true,
      entryRequest: { action: 'create', groupId: 'repo' }, onEntryRequestHandled: vi.fn() });
    expect(await screen.findByRole('heading', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create project' })).toBeInTheDocument();
  });
  it('configures all terminals for a Library child project with the shared command', () => {
    const launch = vi.fn();
    const folder = { id: 'repo', name: 'JaneT', kind: 'folder' as const, directory: 'C:/repo' };
    renderTabs({ groups: [folder], creatorOpen: true, entryRequest: { action: 'create', groupId: 'repo' },
      onEntryRequestHandled: vi.fn(), onWorkspaceTabLaunch: launch });
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Child' } });
    fireEvent.click(screen.getByRole('button', { name: /Add terminals/ }));
    fireEvent.click(screen.getByRole('button', { name: 'More terminals' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hermes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Child', createProject: true, terminalCount: 2,
      root: expect.objectContaining({ children: [
        expect.objectContaining({ terminalType: 'local', startupCommands: ['hermes --tui'] }),
        expect.objectContaining({ terminalType: 'local', startupCommands: ['hermes --tui'] }),
      ] }),
    }), folder);
  });

  it('separates temporary delete/keep actions from non-destructive Library removal', () => {
    const action = vi.fn();
    const view = renderTabs({ groups: [{ id: 'default', name: 'Work', directory: 'C:/temp/Work' }],
      tabs: [{ ...tabs[0], groupId: 'default', cwd: 'C:/temp/Work/App' }], onWorkspaceAction: action });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Main app Local/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep in Library…' }));
    expect(action).toHaveBeenCalledWith('keep', 'default', 'tab-1');
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Main app Local/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project…' }));
    expect(action).toHaveBeenCalledWith('delete', 'default', 'tab-1');
    view.unmount();
    renderTabs({ groups: [{ id: 'linked', name: 'Repo', kind: 'folder', directory: 'C:/repo' }], tabs: [], onWorkspaceAction: action });
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Repo/, expanded: true }));
    expect(screen.queryByRole('menuitem', { name: 'Delete workspace…' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Library…' }));
    expect(action).toHaveBeenCalledWith('unlink', 'linked');
  });
  it('renames a parent group and cancels edits with Escape', () => {
    renderTabs();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Clients/, expanded: true }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename workspace' }));
    const input = screen.getByRole('textbox', { name: 'Workspace name' });
    fireEvent.change(input, { target: { value: 'Cancelled' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /^Clients/, expanded: true })).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Clients/, expanded: true }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename workspace' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Team' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Workspace name' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: /^Team/, expanded: true })).toBeInTheDocument();
  });
  it('offers close deliberately through the keyboard context menu', () => {
    const onCloseTab = vi.fn();
    renderTabs({ tabs: [tabs[0]], onCloseTab });
    expect(screen.queryByRole('button', { name: /close main app/i })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Main app Local/ }), { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close session' }));
    expect(onCloseTab).toHaveBeenCalledWith(tabs[0].id);
  });

  it.each(['Terminal', 'Codex', 'Hermes', 'Claude', 'Custom'])('runs %s in every local project terminal', (choice) => {
    const launch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch: launch });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My workspaces' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Development' } });
    fireEvent.click(screen.getByRole('button', { name: /Add terminals/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '5' } });
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Custom command' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: choice }));
    if (choice === 'Custom') fireEvent.change(screen.getByRole('textbox', { name: 'Custom command' }), { target: { value: '  npm run dev  ' } });
    expect(screen.queryByRole('button', { name: 'SSH connection' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/directory override/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const saved = launch.mock.calls[0][0] as WorkspaceTabPreset;
    const leaves = (node: NonNullable<WorkspaceTabPreset['root']>): any[] => node.type === 'leaf' ? [node] : node.children.flatMap(leaves);
    expect(leaves(saved.root!)).toHaveLength(5);
    for (const leaf of leaves(saved.root!)) {
      expect(leaf.terminalType).toBe('local');
      expect(leaf.cwd).toBeUndefined();
      expect(leaf.startupCommands).toEqual(choice === 'Terminal' ? undefined : [choice === 'Custom' ? 'npm run dev' : choice === 'Hermes' ? 'hermes --tui' : choice.toLowerCase()]);
    }
  });

  it('cancels inline project creation without a modal', () => {
    renderTabs();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My workspaces' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    expect(screen.getByRole('heading', { name: 'Create project' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create project' })).toBeNull();
  });
  it('focuses workspace creation and restores the opener on Escape', async () => {
    renderTabs();
    const opener = screen.getByRole('button', { name: 'New workspace' });
    opener.focus(); fireEvent.click(opener);
    const nameInput = screen.getByRole('textbox', { name: 'Workspace name' });
    await waitFor(() => expect(nameInput).toHaveFocus());
    fireEvent.keyDown(nameInput, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('moves secondary tab actions into a context menu', () => {
    const onRenameTab = vi.fn();
        renderTabs({ onRenameTab });
    const opener = screen.getByRole('button', { name: /Main app Local/i });

    expect(screen.queryByRole('button', { name: /^rename project$/i })).not.toBeInTheDocument();
    fireEvent.contextMenu(opener);
    expect(screen.getByRole('menu').parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('menuitem', { name: /rename session/i }));
    const nameInput = screen.getByRole('textbox', { name: /^tab name$/i });
    expect(nameInput).toHaveAttribute('maxlength', '256');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });

    expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'Renamed');

    fireEvent.contextMenu(opener);
    expect(screen.queryByRole('menuitem', { name: /save/i })).not.toBeInTheDocument();

  });

  it('opens the named tab menu from either keyboard command and restores its opener', async () => {
    renderTabs();
    const opener = screen.getByRole('button', { name: /Main app Local/i });

    act(() => opener.focus());
    fireEvent.keyDown(opener, { key: 'ContextMenu' });

    const menu = screen.getByRole('menu', { name: 'Actions for Main app' });
    const rename = screen.getByRole('menuitem', { name: 'Rename session' });
    const save = screen.getByRole('menuitem', { name: 'Close session' });
    await waitFor(() => expect(rename).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(save).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.keyDown(opener, { key: 'F10', shiftKey: true });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename session' })).toHaveFocus());
  });

  it('closes the tab context menu when clicking outside it', () => {
    renderTabs();
    const opener = screen.getByRole('button', { name: /Main app Local/i });

    act(() => opener.focus());
    fireEvent.contextMenu(opener);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('keeps the tab context menu inside the viewport', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('vtab-context-menu') ? 160 : 0;
      const height = this.classList.contains('vtab-context-menu') ? 80 : 0;
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
    });
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });

    try {
      renderTabs();
      fireEvent.contextMenu(screen.getByRole('button', { name: /Main app Local/i }), {
        clientX: 310,
        clientY: 190,
      });

      await waitFor(() => expect(screen.getByRole('menu')).toHaveStyle({ left: '160px', top: '120px' }));
    } finally {
      rect.mockRestore();
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: previousHeight });
    }
  });

  it('uses single-line rows without location subtitles', () => {
    renderTabs();

    expect(screen.queryByText('Local · repo')).not.toBeInTheDocument();
    expect(screen.queryByText('SSH · pckpr@box.local:22')).not.toBeInTheDocument();
  });

  it('exposes the active terminal tab to assistive technology', () => {
    renderTabs();

    expect(screen.getByRole('button', { name: /Main app Local/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Tools Local/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('uses the aggregate agent status as the compact tab subtitle', () => {
    const status: AgentStatus = { kind: 'finished', label: 'Hermes · Turn finished' };
    renderTabs({ awarenessByTab: { 'tab-2': status } });

    expect(screen.queryByText('Hermes · Turn finished')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tools Hermes · Turn finished/i })).toBeInTheDocument();
  });

  it('validates the count and custom command before creation', () => {
    renderTabs();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My workspaces' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Dev' } });
    fireEvent.click(screen.getByRole('button', { name: /Add terminals/ }));
    const count = screen.getByRole('spinbutton', { name: 'Initial terminals' });
    const submit = screen.getByRole('button', { name: 'Create project' });
    for (const value of ['', '0', '17', '1.5']) {
      fireEvent.change(count, { target: { value } });
      expect(submit).toBeDisabled();
    }
    fireEvent.change(count, { target: { value: '16' } });
    expect(submit).toBeEnabled();
    expect(screen.getByRole('button', { name: 'More terminals' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fewer terminals' }));
    expect(count).toHaveValue(15);
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom command' }), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom command' }), { target: { value: 'npm run dev' } });
    expect(submit).toBeEnabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Hermes' }));
    expect(screen.queryByRole('textbox', { name: 'Custom command' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(screen.getByRole('textbox', { name: 'Custom command' })).toHaveValue('npm run dev');
  });

  it('collapses the tabs panel', () => {
    const onCollapse = vi.fn();
    renderTabs({ onCollapse });

    fireEvent.click(screen.getByRole('button', { name: /collapse terminal tabs/i }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
  it('creates a group without launching terminals and can collapse a populated group', async () => {
    Object.defineProperty(window, 'janet', { configurable: true, value: { ...window.janet, workspaceDirectory: vi.fn().mockResolvedValue('C:/Work/Research') } });
    const onLaunch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch: onLaunch });
    const group = screen.getByRole('button', { name: /^My workspaces/ });
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Main app Local/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('button', { name: /^Research/ })).toBeInTheDocument();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.queryByText('Presets')).not.toBeInTheDocument();
  });

  it('creates three terminals in a new parent group and preserves the draft on launch failure', async () => {
    Object.defineProperty(window, 'janet', { configurable: true, value: { ...window.janet, workspaceDirectory: vi.fn().mockResolvedValue('C:/Work/Research') } });
    const launch = vi.fn().mockRejectedValue(new Error('Terminal limit reached'));
    renderTabs({ onWorkspaceTabLaunch: launch });
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Research' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Experiment' } });
    fireEvent.click(screen.getByRole('button', { name: /Add terminals/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '3' } });
    expect(screen.getByRole('spinbutton', { name: 'Initial terminals' })).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Terminal limit reached'));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Experiment', terminalCount: 3 }), expect.objectContaining({ name: 'Research' }));
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Experiment');
  });

  it('reduces the shared terminal count without discarding configuration', () => {
    renderTabs();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'My workspaces' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add project' }));
    fireEvent.click(screen.getByRole('button', { name: /Add terminals/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '1' } });
    expect(screen.getByRole('spinbutton', { name: 'Initial terminals' })).toHaveValue(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
  });

  it('keeps project actions correctly named without workspace move destinations', () => {
    const close = vi.fn();
    renderTabs({ onCloseTab: close });
    fireEvent.contextMenu(screen.getByRole('button', { name: /Main app Local/ }));
    expect(screen.getByRole('menuitem', { name: 'Rename session' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Move to / })).not.toBeInTheDocument();

    expect(close).not.toHaveBeenCalled();
  });

});
