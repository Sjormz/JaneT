import { describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VerticalTabBar from '../../src/renderer/components/VerticalTabBar';
import { SavedSSHProfile, TabInfo, WorkspaceTabPreset } from '../../src/renderer/types';
import type { AgentStatus } from '../../src/renderer/terminalAwareness';

const sshProfiles: SavedSSHProfile[] = [{
  id: 'pckpr@box.local:22:password',
  host: 'box.local',
  port: 22,
  username: 'pckpr',
  auth: 'password',
  password: 'secret',
}];

const tabs: TabInfo[] = [
  {
    id: 'tab-1',
    title: 'Main app',
    type: 'local',
    cwd: 'C:/repo',
    root: { id: 'split-1', type: 'split', direction: 'vertical', children: [{ id: 'term-1', type: 'leaf' }], sizes: [1] },
  },
  {
    id: 'tab-2',
    title: 'SSH box',
    type: 'ssh',
    sshSessionId: 'ssh-abc123',
    sshProfileId: 'pckpr@box.local:22:password',
    root: { id: 'split-2', type: 'split', direction: 'vertical', children: [{ id: 'term-2', type: 'leaf' }], sizes: [1] },
  },
];


const groups = [{ id: 'default', name: 'My workspaces' }, { id: 'clients', name: 'Clients' }];
function renderTabs(overrides?: Partial<React.ComponentProps<typeof VerticalTabBar>>) {
  function Harness() {
    const [creatorOpen, onCreatorOpenChange] = useState(false);
    const [currentGroups, onGroupsChange] = useState(groups);
    return <VerticalTabBar
      tabs={tabs} activeTabId="tab-1" sshProfiles={sshProfiles}
      groups={currentGroups} onGroupsChange={onGroupsChange} onMoveWorkspace={vi.fn()}
      creatorOpen={creatorOpen} onCreatorOpenChange={onCreatorOpenChange}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()}
      sshConnectionsOpen={false} onSSHConnectionsOpenChange={vi.fn()}
      onSSHConnected={vi.fn()} onSSHProfilesChange={vi.fn()}
      onWorkspaceTabLaunch={vi.fn().mockResolvedValue(undefined)}
      onRenameTab={vi.fn()} onCollapse={vi.fn()} {...overrides} />;
  }
  return render(<Harness />);
}

describe('VerticalTabBar', () => {
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
  it('opens a Library session form for an empty-state destination request', async () => {
    renderTabs({ groups: [{ id: 'repo', name: 'JaneT', kind: 'folder', directory: 'C:/repo' }], creatorOpen: true,
      entryRequest: { action: 'create', groupId: 'repo' }, onEntryRequestHandled: vi.fn() });
    expect(await screen.findByRole('heading', { name: 'New session in JaneT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeInTheDocument();
  });
  it('starts all session terminals in the selected Library folder with the shared command', () => {
    const launch = vi.fn();
    const folder = { id: 'repo', name: 'JaneT', kind: 'folder' as const, directory: 'C:/repo' };
    renderTabs({ groups: [folder], creatorOpen: true, entryRequest: { action: 'create', groupId: 'repo' },
      onEntryRequestHandled: vi.fn(), onWorkspaceTabLaunch: launch });
    fireEvent.click(screen.getByRole('button', { name: 'More terminals' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hermes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Session', terminalCount: 2,
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
  it('labels mixed workspaces by their actual terminal types', () => {
    renderTabs({ tabs: [{ ...tabs[0], root: { id: 'mix', type: 'split', direction: 'vertical', sizes: [1, 1], children: [
      { id: 'local', type: 'leaf', terminalType: 'local' }, { id: 'remote', type: 'leaf', terminalType: 'ssh' },
    ] } }] });
    expect(screen.getByRole('button', { name: /Local \+ SSH · 2 terminals/ })).toBeInTheDocument();
    expect(document.querySelector('.vtab-sub')).toBeNull();
  });
  it('offers close deliberately through the keyboard context menu', () => {
    const onCloseTab = vi.fn();
    renderTabs({ tabs: [tabs[0]], onCloseTab });
    expect(screen.queryByRole('button', { name: /close main app/i })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Main app Local/ }), { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close session' }));
    expect(onCloseTab).toHaveBeenCalledWith(tabs[0].id);
  });

  it('labels the section as Tabs and creates a local terminal from its visible action', () => {
    const onLocalAt = vi.fn().mockResolvedValue(undefined);
    renderTabs({ onLocalAt });

    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New local terminal tab' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Local terminal in My workspaces' }));
    expect(onLocalAt).toHaveBeenCalledWith('default');
  });

  it('hides sidebar SSH entry points pending review while retaining Local actions', () => {
    renderTabs({ sshConnectionsOpen: true });
    expect(screen.queryByRole('button', { name: /^SSH terminal in/ })).not.toBeInTheDocument();
    expect(document.getElementById('vtab-ssh-connections')).toBeNull();
    expect(screen.getByRole('button', { name: 'Local terminal in My workspaces' })).toBeInTheDocument();
  });

  it('keeps compact project launch controls separate from row selection', () => {
    const onLocalAt = vi.fn().mockResolvedValue(undefined);
    const onSelectTab = vi.fn();
    renderTabs({ onLocalAt, onSelectTab });
    const launch = screen.getByRole('button', { name: `Local terminal in session ${tabs[0].title}` });
    expect(launch).toHaveClass('directory-terminal-launch');
    expect(launch).toHaveAttribute('data-tooltip-label', 'Add terminal here');
    expect(launch.closest('.vtab-item')).toBeNull();
    expect(launch.textContent).toBe('');
    fireEvent.click(launch);
    expect(onLocalAt).toHaveBeenCalledWith('default', tabs[0].id);
    expect(onSelectTab).not.toHaveBeenCalled();
  });

  // TODO: Restore these integration checks when sidebar SSH entry points are reviewed.
  it.skip('opens and closes SSH connection management from the Tabs section', () => {
    const onSSHConnectionsOpenChange = vi.fn();

    function Harness() {
      const [sshConnectionsOpen, setSSHConnectionsOpen] = useState(false);
      return (
        <VerticalTabBar
          tabs={tabs}
          activeTabId="tab-1"
          sshProfiles={sshProfiles}
          groups={groups} creatorOpen={false} onCreatorOpenChange={vi.fn()} onGroupsChange={vi.fn()} onMoveWorkspace={vi.fn()}
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewTab={vi.fn()}
          sshConnectionsOpen={sshConnectionsOpen}
          onSSHConnectionsOpenChange={(open) => {
            onSSHConnectionsOpenChange(open);
            setSSHConnectionsOpen(open);
          }}
          onSSHConnected={vi.fn()}
          onSSHProfilesChange={vi.fn()}

          onWorkspaceTabLaunch={vi.fn()}

          onRenameTab={vi.fn()}
          onCollapse={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'SSH terminal in My workspaces' });
    fireEvent.click(toggle);

    expect(onSSHConnectionsOpenChange).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Saved connections')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onSSHConnectionsOpenChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Saved connections')).not.toBeInTheDocument();
  });

  it.skip('forwards SSH sessions and saved-profile changes from the embedded manager', async () => {
    const sshConnect = vi.fn().mockResolvedValue({ connected: true });
    Object.defineProperty(window, 'janet', {
      configurable: true,
      value: { sshConnect },
    });
    const onSSHConnected = vi.fn();
    const onSSHProfilesChange = vi.fn();
    renderTabs({
      sshConnectionsOpen: true,
      onSSHConnected,
      onSSHProfilesChange,
    });

    fireEvent.click(screen.getByRole('button', { name: /connect to pckpr@box\.local:22/i }));
    await waitFor(() => expect(onSSHConnected).toHaveBeenCalledWith(expect.objectContaining({
      host: 'box.local',
      port: 22,
      username: 'pckpr',
      sshProfileId: sshProfiles[0].id,
    })));

    fireEvent.click(screen.getByRole('button', { name: /remove pckpr@box\.local:22/i }));
    expect(onSSHProfilesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove connection' }));
    expect(onSSHProfilesChange).toHaveBeenCalledWith([]);
  });

  it.each(['Codex', 'Hermes', 'Claude', 'Custom'])('runs %s in every local project terminal', (choice) => {
    const launch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch: launch });
    fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Development' } });
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
      expect(leaf.startupCommands).toEqual([choice === 'Custom' ? 'npm run dev' : choice === 'Hermes' ? 'hermes --tui' : choice.toLowerCase()]);
    }
  });

  it('closes the workspace creation dialog from its backdrop', () => {
    renderTabs();

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('focuses the workspace form and restores the opener on Escape', async () => {
    renderTabs();

        const opener = screen.getByRole('button', { name: /new project in My workspaces/i });
    opener.focus();
    fireEvent.click(opener);

    const nameInput = screen.getByRole('textbox', { name: /project name/i });
    await waitFor(() => expect(nameInput).toHaveFocus());
    fireEvent.keyDown(nameInput, { key: 'Escape' });

    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /save tab name/i }));

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

  it('creates, lists, and deliberately stops a forward for a ready live SSH tab', async () => {
    const running = {
      id: 'forward-test', bindHost: '127.0.0.1', localPort: 43123, status: 'running',
      destinationHost: '127.0.0.1', destinationPort: 9000,
    };
    const sshListLocalForwards = vi.fn().mockResolvedValue([]);
    const sshStartLocalForward = vi.fn().mockResolvedValue(running);
    const sshStopLocalForward = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'janet', {
      configurable: true,
      value: { sshListLocalForwards, sshStartLocalForward, sshStopLocalForward },
    });
    renderTabs({ tabs: [{ ...tabs[1], sshShellReady: true }], activeTabId: 'tab-2' });

    fireEvent.contextMenu(screen.getByRole('button', { name: /^SSH box SSH/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage local forwards' }));
    const dialog = await screen.findByRole('dialog', { name: 'SSH local forwards' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    await waitFor(() => expect(sshListLocalForwards).toHaveBeenCalledWith({ sessionId: 'ssh-abc123' }));

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Local port' }), { target: { value: '0' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Destination host' }), { target: { value: '127.0.0.1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Destination port' }), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create forward' }));
    await waitFor(() => expect(sshStartLocalForward).toHaveBeenCalledWith({
      sessionId: 'ssh-abc123',
      request: expect.objectContaining({ localPort: 0, destinationHost: '127.0.0.1', destinationPort: 9000 }),
    }));
    expect(await screen.findByText('127.0.0.1:43123')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Stop forward 127.0.0.1:43123' }));
    await waitFor(() => expect(sshStopLocalForward).toHaveBeenCalledWith({
      sessionId: 'ssh-abc123', id: 'forward-test',
    }));
    await waitFor(() => expect(screen.queryByText('127.0.0.1:43123')).not.toBeInTheDocument());
  });

  it('removes each forward after concurrent stop requests settle', async () => {
    const running = [
      { id: 'forward-a', bindHost: '127.0.0.1', localPort: 43123, status: 'running', destinationHost: 'a.local', destinationPort: 80 },
      { id: 'forward-b', bindHost: '127.0.0.1', localPort: 43124, status: 'running', destinationHost: 'b.local', destinationPort: 443 },
    ];
    const resolutions = new Map<string, () => void>();
    const sshStopLocalForward = vi.fn(({ id }: { id: string }) => new Promise<void>((resolve) => resolutions.set(id, resolve)));
    Object.defineProperty(window, 'janet', {
      configurable: true,
      value: { sshListLocalForwards: vi.fn().mockResolvedValue(running), sshStartLocalForward: vi.fn(), sshStopLocalForward },
    });
    renderTabs({ tabs: [{ ...tabs[1], sshShellReady: true }], activeTabId: 'tab-2' });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^SSH box SSH/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage local forwards' }));
    await screen.findByText('127.0.0.1:43123');
    await screen.findByText('127.0.0.1:43124');

    fireEvent.click(screen.getByRole('button', { name: 'Stop forward 127.0.0.1:43123' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop forward 127.0.0.1:43124' }));
    await waitFor(() => expect(sshStopLocalForward).toHaveBeenCalledTimes(2));
    resolutions.get('forward-a')!();
    await waitFor(() => expect(screen.queryByText('127.0.0.1:43123')).not.toBeInTheDocument());
    resolutions.get('forward-b')!();
    await waitFor(() => expect(screen.queryByText('127.0.0.1:43124')).not.toBeInTheDocument());
  });

  it('fails closed when the forward dialog SSH tab is no longer ready', async () => {
    let resolveList!: (value: unknown[]) => void;
    const sshListLocalForwards = vi.fn(() => new Promise<unknown[]>((resolve) => { resolveList = resolve; }));
    Object.defineProperty(window, 'janet', {
      configurable: true,
      value: { sshListLocalForwards, sshStartLocalForward: vi.fn(), sshStopLocalForward: vi.fn() },
    });
    const readyTab = { ...tabs[1], sshShellReady: true };
    const view = renderTabs({ tabs: [readyTab], activeTabId: 'tab-2' });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^SSH box SSH/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage local forwards' }));
    expect(await screen.findByRole('dialog', { name: 'SSH local forwards' })).toBeInTheDocument();

    view.rerender(<VerticalTabBar
      tabs={[{ ...readyTab, sshShellReady: false }]} activeTabId="tab-2" sshProfiles={sshProfiles} groups={groups} creatorOpen={false} onCreatorOpenChange={vi.fn()} onGroupsChange={vi.fn()} onMoveWorkspace={vi.fn()}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()} sshConnectionsOpen={false}
      onSSHConnectionsOpenChange={vi.fn()} onSSHConnected={vi.fn()} onSSHProfilesChange={vi.fn()}
       onWorkspaceTabLaunch={vi.fn()}
      onRenameTab={vi.fn()} onCollapse={vi.fn()}
    />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SSH local forwards' })).not.toBeInTheDocument());
    resolveList([{ id: 'late', bindHost: '127.0.0.1', localPort: 49999, destinationHost: 'x', destinationPort: 1, status: 'running' }]);
    await act(async () => {});
    expect(screen.queryByText('127.0.0.1:49999')).not.toBeInTheDocument();
  });

  it('stops a forward that starts after its SSH tab is no longer ready', async () => {
    const running = {
      id: 'late-forward', bindHost: '127.0.0.1', localPort: 49999, status: 'running',
      destinationHost: '127.0.0.1', destinationPort: 9000,
    };
    let resolveStart!: (value: typeof running) => void;
    const sshStartLocalForward = vi.fn(() => new Promise<typeof running>((resolve) => { resolveStart = resolve; }));
    const sshStopLocalForward = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'janet', {
      configurable: true,
      value: { sshListLocalForwards: vi.fn().mockResolvedValue([]), sshStartLocalForward, sshStopLocalForward },
    });
    const readyTab = { ...tabs[1], sshShellReady: true };
    const view = renderTabs({ tabs: [readyTab], activeTabId: 'tab-2' });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^SSH box SSH/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage local forwards' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Destination host' }), { target: { value: '127.0.0.1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Destination port' }), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create forward' }));
    await waitFor(() => expect(sshStartLocalForward).toHaveBeenCalledOnce());

    view.rerender(<VerticalTabBar
      tabs={[{ ...readyTab, sshShellReady: false }]} activeTabId="tab-2" sshProfiles={sshProfiles} groups={groups} creatorOpen={false} onCreatorOpenChange={vi.fn()} onGroupsChange={vi.fn()} onMoveWorkspace={vi.fn()}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()} sshConnectionsOpen={false}
      onSSHConnectionsOpenChange={vi.fn()} onSSHConnected={vi.fn()} onSSHProfilesChange={vi.fn()}
       onWorkspaceTabLaunch={vi.fn()}
      onRenameTab={vi.fn()} onCollapse={vi.fn()}
    />);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'SSH local forwards' })).not.toBeInTheDocument());
    resolveStart(running);

    await waitFor(() => expect(sshStopLocalForward).toHaveBeenCalledWith({
      sessionId: 'ssh-abc123', id: 'late-forward',
    }));
  });

  it('stops a forward that starts after the tab rail unmounts', async () => {
    const running = {
      id: 'late-forward', bindHost: '127.0.0.1', localPort: 49999, status: 'running',
      destinationHost: '127.0.0.1', destinationPort: 9000,
    };
    let resolveStart!: (value: typeof running) => void;
    const sshStartLocalForward = vi.fn(() => new Promise<typeof running>((resolve) => { resolveStart = resolve; }));
    const sshStopLocalForward = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'janet', {
      configurable: true,
      value: { sshListLocalForwards: vi.fn().mockResolvedValue([]), sshStartLocalForward, sshStopLocalForward },
    });
    const view = renderTabs({ tabs: [{ ...tabs[1], sshShellReady: true }], activeTabId: 'tab-2' });
    fireEvent.contextMenu(screen.getByRole('button', { name: /^SSH box SSH/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage local forwards' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Destination host' }), { target: { value: '127.0.0.1' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Destination port' }), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create forward' }));
    await waitFor(() => expect(sshStartLocalForward).toHaveBeenCalledOnce());

    view.unmount();
    resolveStart(running);

    await waitFor(() => expect(sshStopLocalForward).toHaveBeenCalledWith({
      sessionId: 'ssh-abc123', id: 'late-forward',
    }));
  });

  it('uses single-line rows without local or SSH subtitles', () => {
    renderTabs();

    expect(screen.queryByText('Local · repo')).not.toBeInTheDocument();
    expect(screen.queryByText('SSH · pckpr@box.local:22')).not.toBeInTheDocument();
  });

  it('exposes the active terminal tab to assistive technology', () => {
    renderTabs();

    expect(screen.getByRole('button', { name: /Main app Local/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /SSH box SSH/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Workspaces' })).toBeInTheDocument();
  });

  it('uses the aggregate agent status as the compact tab subtitle', () => {
    const status: AgentStatus = { kind: 'finished', label: 'Hermes · Turn finished' };
    renderTabs({ awarenessByTab: { 'tab-2': status } });

    expect(screen.queryByText('Hermes · Turn finished')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SSH box Hermes · Turn finished/i })).toBeInTheDocument();
  });

  it('validates the count and custom command before creation', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Dev' } });
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
  it('creates a group without launching terminals and can collapse a populated group', () => {
    const onLaunch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch: onLaunch });
    const group = screen.getByRole('button', { name: /^My workspaces/ });
    fireEvent.click(group);
    expect(group).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Main app Local/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New workspace or project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(screen.getByRole('button', { name: /^Research/ })).toBeInTheDocument();
    expect(onLaunch).not.toHaveBeenCalled();
    expect(screen.queryByText('Presets')).not.toBeInTheDocument();
  });

  it('creates three terminals in a new parent group and preserves the draft on launch failure', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('Terminal limit reached'));
    renderTabs({ onWorkspaceTabLaunch: launch });
    fireEvent.click(screen.getByRole('button', { name: 'New workspace or project' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'New project in Research' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Experiment' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '3' } });
    expect(screen.getByRole('spinbutton', { name: 'Initial terminals' })).toHaveValue(3);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Terminal limit reached'));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Experiment', terminalCount: 3 }), expect.objectContaining({ name: 'Research' }));
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Experiment');
  });

  it('reduces the shared terminal count without discarding configuration', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'New workspace or project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Initial terminals' }), { target: { value: '1' } });
    expect(screen.getByRole('spinbutton', { name: 'Initial terminals' })).toHaveValue(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
  });

  it('keeps project actions correctly named without workspace move destinations', () => {
    const move = vi.fn(), close = vi.fn();
    renderTabs({ onMoveWorkspace: move, onCloseTab: close });
    fireEvent.contextMenu(screen.getByRole('button', { name: /Main app Local/ }));
    expect(screen.getByRole('menuitem', { name: 'Rename session' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Move to / })).not.toBeInTheDocument();
    expect(move).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

});
