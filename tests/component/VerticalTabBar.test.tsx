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
  it('renames a parent group and cancels edits with Escape', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'Rename workspace Clients' }));
    const input = screen.getByRole('textbox', { name: 'Group name' });
    fireEvent.change(input, { target: { value: 'Cancelled' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /^Clients/, expanded: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rename workspace Clients' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), { target: { value: 'Team' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Group name' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: /^Team/, expanded: true })).toBeInTheDocument();
  });
  it('labels mixed workspaces by their actual terminal types', () => {
    renderTabs({ tabs: [{ ...tabs[0], root: { id: 'mix', type: 'split', direction: 'vertical', sizes: [1, 1], children: [
      { id: 'local', type: 'leaf', terminalType: 'local' }, { id: 'remote', type: 'leaf', terminalType: 'ssh' },
    ] } }] });
    expect(screen.getByText('Local + SSH · 2 terminals')).toBeInTheDocument();
  });
  it('shows a close action even when there is only one tab', () => {
    renderTabs({ tabs: [tabs[0]] });

    expect(screen.getByRole('button', { name: /close main app/i })).toBeInTheDocument();
  });

  it('labels the section as Tabs and creates a local terminal from its visible action', () => {
    const onNewTab = vi.fn();
    renderTabs({ onNewTab });

    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SSH connections' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^new local terminal tab$/i }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it('opens and closes SSH connection management from the Tabs section', () => {
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
    const toggle = screen.getByRole('button', { name: 'SSH connections' });
    fireEvent.click(toggle);

    expect(onSSHConnectionsOpenChange).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Saved connections')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onSSHConnectionsOpenChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Saved connections')).not.toBeInTheDocument();
  });

  it('forwards SSH sessions and saved-profile changes from the embedded manager', async () => {
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

  it('creates optional names for each workspace terminal', () => {
    const onWorkspaceTabLaunch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch });

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /project name/i }), { target: { value: 'Named workspace' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 1 name (optional)' }), { target: { value: '  Dev server  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^add terminal$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 2 name (optional)' }), { target: { value: 'Tests' } });
    fireEvent.click(screen.getByRole('button', { name: /^create project$/i }));

    const saved = onWorkspaceTabLaunch.mock.calls[0][0] as WorkspaceTabPreset;
    const leaves = saved.root?.type === 'split' ? saved.root.children : [saved.root];
    expect(leaves).toEqual([
      expect.objectContaining({ type: 'leaf', title: 'Dev server' }),
      expect.objectContaining({ type: 'leaf', title: 'Tests' }),
    ]);
  });

  it('creates, reorders, trims, and saves per-terminal startup commands', () => {
    const onWorkspaceTabLaunch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch });

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /project name/i }), { target: { value: 'Automated' } });
    fireEvent.click(screen.getByRole('button', { name: /startup commands/i }));

    expect(screen.getByText(/commands run in order and stop if one fails/i)).toBeInTheDocument();
    expect(screen.getByText(/other recognized shells use a short fallback delay/i)).toBeInTheDocument();
    expect(screen.getByText(/may appear in shell history/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 1 startup command 1' }), { target: { value: '  npm install  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 1 startup command 2' }), { target: { value: 'npm run dev' } });
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Move startup command 2 up' }));
    fireEvent.click(screen.getByRole('button', { name: /^create project$/i }));

    const saved = onWorkspaceTabLaunch.mock.calls[0][0] as WorkspaceTabPreset;
    expect(saved.root).toMatchObject({
      children: [expect.objectContaining({
        startupCommands: ['npm run dev', 'npm install'],
      })],
    });
  });

  it('confirms startup-command removal and keeps the parent editor open on Escape', async () => {
    renderTabs();

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.click(screen.getByRole('button', { name: /startup commands/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove startup command 1' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Remove startup command 1?' });
    expect(screen.getAllByRole('textbox', { name: /terminal 1 startup command/i })).toHaveLength(2);
    fireEvent.keyDown(confirmation, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /create project/i })).toBeInTheDocument();
    expect(screen.getAllByRole('textbox', { name: /terminal 1 startup command/i })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Remove startup command 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove command' }));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Terminal 1 startup command 1' }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Remove startup command 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove command' }));
    await waitFor(() => expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /^add command$/i }),
    ));
  });

  it('keeps disclosure state and restores focus when terminal removal leaves one entry', async () => {
    renderTabs();

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add terminal$/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /startup commands/i })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove terminal 1' }));
    expect(screen.getAllByRole('button', { name: 'Local terminal' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove terminal' }));

    const remainingTypeButton = screen.getByRole('button', { name: 'Local terminal' });
    await waitFor(() => expect(document.activeElement).toBe(remainingTypeButton));
    expect(screen.getByRole('button', { name: /startup commands/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('preserves commands across terminal type changes and defaults SSH syntax to POSIX', () => {
    const onWorkspaceTabLaunch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch });

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /project name/i }), { target: { value: 'Remote automated' } });
    fireEvent.click(screen.getByRole('button', { name: /startup commands/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 1 startup command 1' }), { target: { value: 'hermes --tui' } });
    fireEvent.click(screen.getByRole('button', { name: 'SSH connection' }));

    expect(screen.getByRole('button', { name: 'SSH connection' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Terminal 1 remote shell syntax' })).toHaveValue('posix');
    fireEvent.change(screen.getByRole('combobox', { name: 'Terminal 1 remote shell syntax' }), {
      target: { value: 'fish' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Local terminal' }));
    expect(screen.getByRole('textbox', { name: 'Terminal 1 startup command 1' })).toHaveValue('hermes --tui');
    fireEvent.click(screen.getByRole('button', { name: 'SSH connection' }));
    expect(screen.getByRole('combobox', { name: 'Terminal 1 remote shell syntax' })).toHaveValue('fish');
    fireEvent.click(screen.getByRole('button', { name: 'Terminal 1 SSH profile' }));
    fireEvent.click(screen.getByRole('option', { name: 'pckpr@box.local:22' }));
    fireEvent.click(screen.getByRole('button', { name: /^create project$/i }));

    const saved = onWorkspaceTabLaunch.mock.calls[0][0] as WorkspaceTabPreset;
    expect(saved.root).toMatchObject({
      children: [expect.objectContaining({
        terminalType: 'ssh',
        startupCommands: ['hermes --tui'],
        startupShellDialect: 'fish',
      })],
    });
  });

  it('chooses an SSH profile from the custom workspace picker', () => {
    const onWorkspaceTabLaunch = vi.fn();
    renderTabs({ onWorkspaceTabLaunch });

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /project name/i }), { target: { value: 'Remote workspace' } });
    fireEvent.click(screen.getByRole('button', { name: 'SSH connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Terminal 1 SSH profile' }));
    fireEvent.click(screen.getByRole('option', { name: 'pckpr@box.local:22' }));
    fireEvent.click(screen.getByRole('button', { name: /^create project$/i }));

    expect(onWorkspaceTabLaunch).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Remote workspace',
      root: expect.objectContaining({ children: [expect.objectContaining({ sshProfileId: sshProfiles[0].id })] }),
    }), groups[0]);
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

    expect(screen.queryByRole('button', { name: /^rename workspace$/i })).not.toBeInTheDocument();
    fireEvent.contextMenu(opener);
    expect(screen.getByRole('menu').parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('menuitem', { name: /rename workspace/i }));
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
    const rename = screen.getByRole('menuitem', { name: 'Rename workspace' });
    const save = screen.getByRole('menuitem', { name: 'Move to Clients' });
    await waitFor(() => expect(rename).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(save).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.keyDown(opener, { key: 'F10', shiftKey: true });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename workspace' })).toHaveFocus());
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

    fireEvent.contextMenu(screen.getByRole('button', { name: /close ssh box/i }).closest('.vtab-item')!);
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
    fireEvent.contextMenu(screen.getByRole('button', { name: /close ssh box/i }).closest('.vtab-item')!);
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
    fireEvent.contextMenu(screen.getByRole('button', { name: /close ssh box/i }).closest('.vtab-item')!);
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
    fireEvent.contextMenu(screen.getByRole('button', { name: /close ssh box/i }).closest('.vtab-item')!);
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
    fireEvent.contextMenu(screen.getByRole('button', { name: /close ssh box/i }).closest('.vtab-item')!);
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

  it('shows scan-friendly subtitles for local and SSH tabs', () => {
    renderTabs();

    expect(screen.getByText('Local · repo')).toBeInTheDocument();
    expect(screen.getByText('SSH · pckpr@box.local:22')).toBeInTheDocument();
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

    expect(screen.getByText('Hermes · Turn finished')).toHaveClass('vtab-sub', 'finished');
    expect(screen.getByRole('button', { name: /SSH box Hermes · Turn finished/i })).toBeInTheDocument();
  });

  it('explains why an SSH workspace cannot be created without a saved connection', () => {
    renderTabs({ sshProfiles: [] });

        fireEvent.click(screen.getByRole('button', { name: /new project in My workspaces/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /project name/i }), { target: { value: 'Remote' } });
    fireEvent.click(screen.getByRole('button', { name: 'SSH connection' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Terminal 1 needs a saved SSH connection.');
    expect(screen.getByRole('button', { name: /^create project$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Terminal 1 SSH profile' }));
    expect(screen.getByRole('option', { name: 'No saved SSH connections' })).toHaveAttribute('aria-disabled', 'true');
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
    fireEvent.click(screen.getByRole('button', { name: 'Workspace', exact: true }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'New project in Research' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Experiment' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Initial terminals' }), { target: { value: '3' } });
    expect(screen.getAllByRole('button', { name: 'Local terminal' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Terminal limit reached'));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Experiment', terminalCount: 3 }), expect.objectContaining({ name: 'Research' }));
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Experiment');
  });

  it('requires confirmation before reducing the configured terminal count', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'New workspace or project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Project', exact: true }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Initial terminals' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Initial terminals' }), { target: { value: '1' } });
    expect(screen.getAllByRole('button', { name: 'Local terminal' })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Reduce terminals' }));
    expect(screen.getAllByRole('button', { name: 'Local terminal' })).toHaveLength(1);
  });

  it('moves a workspace through an accessible menu without closing it', () => {
    const move = vi.fn(), close = vi.fn();
    renderTabs({ onMoveWorkspace: move, onCloseTab: close });
    fireEvent.contextMenu(screen.getByRole('button', { name: /Main app Local/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to Clients' }));
    expect(move).toHaveBeenCalledWith('tab-1', 'clients');
    expect(close).not.toHaveBeenCalled();
  });

});
