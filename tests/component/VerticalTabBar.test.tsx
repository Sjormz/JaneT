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

const workspaceTabs: WorkspaceTabPreset[] = [{
  id: 'ws-1',
  name: 'Janet dev',
  type: 'local',
  cwd: '/Users/dev/janet',
  terminalCount: 1,
  splitDirection: 'vertical',
}];

function renderTabs(overrides?: Partial<React.ComponentProps<typeof VerticalTabBar>>) {
  return render(
    <VerticalTabBar
      tabs={tabs}
      activeTabId="tab-1"
      sshProfiles={sshProfiles}
      workspaceTabs={[]}
      onSelectTab={vi.fn()}
      onCloseTab={vi.fn()}
      onNewTab={vi.fn()}
      sshConnectionsOpen={false}
      onSSHConnectionsOpenChange={vi.fn()}
      onSSHConnected={vi.fn()}
      onSSHProfilesChange={vi.fn()}
      onWorkspaceTabsChange={vi.fn()}
      onWorkspaceTabLaunch={vi.fn()}
      onRenameTab={vi.fn()}
      onCollapse={vi.fn()}
      {...overrides}
      onSaveWorkspaceTab={overrides?.onSaveWorkspaceTab ?? vi.fn()}
    />,
  );
}

describe('VerticalTabBar', () => {
  it('shows a close action even when there is only one tab', () => {
    renderTabs({ tabs: [tabs[0]] });

    expect(screen.getByRole('button', { name: /close main app/i })).toBeInTheDocument();
  });

  it('labels the section as Tabs and creates a local terminal from its visible action', () => {
    const onNewTab = vi.fn();
    renderTabs({ onNewTab });

    expect(screen.getByText('Tabs')).toBeInTheDocument();
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
          workspaceTabs={[]}
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
          onWorkspaceTabsChange={vi.fn()}
          onWorkspaceTabLaunch={vi.fn()}
          onSaveWorkspaceTab={vi.fn()}
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

  it('creates a saved workspace preset from the presets section', () => {
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ onWorkspaceTabsChange });

    // Expand the presets section first (collapsed by default)
    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));

    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    expect(screen.getByRole('dialog', { name: /create preset/i }).parentElement?.parentElement).toBe(document.body);
    fireEvent.change(screen.getByRole('textbox', { name: /preset name/i }), { target: { value: 'JaneT workspace' } });
    fireEvent.change(screen.getByPlaceholderText(/directory path/i), { target: { value: '~/projects/janet' } });
    fireEvent.click(screen.getByRole('button', { name: /^create preset$/i }));

    expect(onWorkspaceTabsChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        name: 'JaneT workspace',
        terminalCount: 1,
        root: expect.objectContaining({ type: 'split' }),
      }),
    ]));
  });

  it('creates optional names for each preset terminal', () => {
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /preset name/i }), { target: { value: 'Named workspace' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 1 name (optional)' }), { target: { value: '  Dev server  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^add terminal$/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 2 name (optional)' }), { target: { value: 'Tests' } });
    fireEvent.click(screen.getByRole('button', { name: /^create preset$/i }));

    const saved = onWorkspaceTabsChange.mock.calls[0][0][0] as WorkspaceTabPreset;
    const leaves = saved.root?.type === 'split' ? saved.root.children : [saved.root];
    expect(leaves).toEqual([
      expect.objectContaining({ type: 'leaf', title: 'Dev server' }),
      expect.objectContaining({ type: 'leaf', title: 'Tests' }),
    ]);
  });

  it('loads, clears, and saves existing preset terminal names', () => {
    const onWorkspaceTabsChange = vi.fn();
    const namedPreset: WorkspaceTabPreset = {
      id: 'named-workspace', name: 'Named workspace', type: 'local',
      terminalCount: 2, splitDirection: 'vertical',
      root: {
        type: 'split', direction: 'vertical', sizes: [1, 1],
        children: [
          { type: 'leaf', terminalType: 'local', title: 'Dev server' },
          { type: 'leaf', terminalType: 'local', title: 'Tests' },
        ],
      },
    };
    renderTabs({ workspaceTabs: [namedPreset], onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /edit preset named workspace/i }));
    expect(screen.getByRole('textbox', { name: 'Terminal 1 name (optional)' })).toHaveValue('Dev server');
    expect(screen.getByRole('textbox', { name: 'Terminal 2 name (optional)' })).toHaveValue('Tests');
    fireEvent.change(screen.getByRole('textbox', { name: 'Terminal 1 name (optional)' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }));

    const updated = onWorkspaceTabsChange.mock.calls[0][0][0] as WorkspaceTabPreset;
    const updatedLeaves = updated.root?.type === 'split' ? updated.root.children : [updated.root];
    expect(updatedLeaves[0]).not.toHaveProperty('title');
    expect(updatedLeaves[1]).toMatchObject({ title: 'Tests' });
  });

  it('creates, reorders, trims, and saves per-terminal startup commands', () => {
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /preset name/i }), { target: { value: 'Automated' } });
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
    fireEvent.click(screen.getByRole('button', { name: /^create preset$/i }));

    const saved = onWorkspaceTabsChange.mock.calls[0][0][0] as WorkspaceTabPreset;
    expect(saved.root).toMatchObject({
      children: [expect.objectContaining({
        startupCommands: ['npm run dev', 'npm install'],
      })],
    });
  });

  it('caps each terminal at sixteen single-line startup commands', () => {
    const cappedPreset: WorkspaceTabPreset = {
      id: 'capped-preset', name: 'Capped preset', type: 'local', terminalCount: 1,
      splitDirection: 'vertical',
      root: {
        type: 'leaf', terminalType: 'local',
        startupCommands: Array.from({ length: 16 }, (_, index) => `echo ${index + 1}`),
      },
    };
    renderTabs({ workspaceTabs: [cappedPreset] });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /edit preset capped preset/i }));

    const commandInputs = screen.getAllByRole('textbox', { name: /terminal 1 startup command/i });
    expect(commandInputs).toHaveLength(16);
    expect(commandInputs[0]).toHaveAttribute('maxlength', '4096');
    expect(screen.getByRole('button', { name: /^add command$/i })).toBeDisabled();
  });

  it('confirms startup-command removal and keeps the parent editor open on Escape', async () => {
    renderTabs();

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.click(screen.getByRole('button', { name: /startup commands/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^add command$/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove startup command 1' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Remove startup command 1?' });
    expect(screen.getAllByRole('textbox', { name: /terminal 1 startup command/i })).toHaveLength(2);
    fireEvent.keyDown(confirmation, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /create preset/i })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
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
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /preset name/i }), { target: { value: 'Remote automated' } });
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
    fireEvent.click(screen.getByRole('button', { name: /^create preset$/i }));

    const saved = onWorkspaceTabsChange.mock.calls[0][0][0] as WorkspaceTabPreset;
    expect(saved.root).toMatchObject({
      children: [expect.objectContaining({
        terminalType: 'ssh',
        startupCommands: ['hermes --tui'],
        startupShellDialect: 'fish',
      })],
    });
  });

  it('loads existing startup commands for editing and reports their preset count', () => {
    const automatedPreset: WorkspaceTabPreset = {
      id: 'automated-preset',
      name: 'Automated preset',
      type: 'local',
      terminalCount: 1,
      splitDirection: 'vertical',
      root: {
        type: 'leaf', terminalType: 'local',
        startupCommands: ['git pull', 'npm install'],
      },
    };
    renderTabs({ workspaceTabs: [automatedPreset] });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    expect(screen.getByText('1 terminal · 2 startup commands')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit preset automated preset/i }));

    expect(screen.getByRole('button', { name: /startup commands/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Terminal 1 startup command 1' })).toHaveValue('git pull');
    fireEvent.click(screen.getByRole('button', { name: 'Remove startup command 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove command' }));
    expect(screen.getByRole('textbox', { name: 'Terminal 1 startup command 1' })).toHaveValue('npm install');
  });

  it('preserves a rootless legacy local preset when editing and saving', () => {
    const onWorkspaceTabsChange = vi.fn();
    const legacyPreset: WorkspaceTabPreset = {
      id: 'legacy-local',
      name: 'Legacy local',
      type: 'local',
      cwd: '/work/legacy',
      terminalCount: 3,
      splitDirection: 'horizontal',
    };
    renderTabs({ workspaceTabs: [legacyPreset], onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /edit preset legacy local/i }));

    expect(screen.getAllByRole('group', { name: /terminal \d+ type/i })).toHaveLength(3);
    for (const input of screen.getAllByRole('textbox', { name: /terminal \d+ directory/i })) {
      expect(input).toHaveValue('/work/legacy');
    }
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const saved = onWorkspaceTabsChange.mock.calls[0][0][0] as WorkspaceTabPreset;
    expect(saved).toMatchObject({
      id: 'legacy-local',
      type: 'local',
      cwd: '/work/legacy',
      terminalCount: 3,
      splitDirection: 'horizontal',
      root: {
        type: 'split',
        direction: 'horizontal',
        children: [
          { terminalType: 'local', cwd: '/work/legacy' },
          { terminalType: 'local', cwd: '/work/legacy' },
          { terminalType: 'local', cwd: '/work/legacy' },
        ],
      },
    });
  });

  it('preserves a rootless legacy SSH preset when editing and saving', () => {
    const onWorkspaceTabsChange = vi.fn();
    const legacyPreset: WorkspaceTabPreset = {
      id: 'legacy-ssh',
      name: 'Legacy SSH',
      type: 'ssh',
      sshProfileId: sshProfiles[0].id,
      terminalCount: 2,
      splitDirection: 'vertical',
    };
    renderTabs({ workspaceTabs: [legacyPreset], onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /edit preset legacy ssh/i }));

    expect(screen.getAllByRole('button', { name: /terminal \d+ ssh profile/i })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'SSH connection' })).toHaveLength(2);
    for (const button of screen.getAllByRole('button', { name: 'SSH connection' })) {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const saved = onWorkspaceTabsChange.mock.calls[0][0][0] as WorkspaceTabPreset;
    expect(saved).toMatchObject({
      id: 'legacy-ssh',
      type: 'ssh',
      sshProfileId: sshProfiles[0].id,
      terminalCount: 2,
      splitDirection: 'vertical',
      root: {
        type: 'split',
        direction: 'vertical',
        children: [
          { terminalType: 'ssh', sshProfileId: sshProfiles[0].id },
          { terminalType: 'ssh', sshProfileId: sshProfiles[0].id },
        ],
      },
    });
  });

  it('chooses an SSH profile from the custom workspace picker', () => {
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /preset name/i }), { target: { value: 'Remote workspace' } });
    fireEvent.click(screen.getByRole('button', { name: 'SSH connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Terminal 1 SSH profile' }));
    fireEvent.click(screen.getByRole('option', { name: 'pckpr@box.local:22' }));
    fireEvent.click(screen.getByRole('button', { name: /^create preset$/i }));

    expect(onWorkspaceTabsChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        name: 'Remote workspace',
        root: expect.objectContaining({
          children: [expect.objectContaining({ sshProfileId: sshProfiles[0].id })],
        }),
      }),
    ]));
  });

  it('closes the workspace preset dialog from its backdrop', () => {
    renderTabs();

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('launches a workspace preset from the presets section', () => {
    const onWorkspaceTabLaunch = vi.fn();
    renderTabs({ workspaceTabs, onWorkspaceTabLaunch });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /open preset janet dev/i }));

    expect(onWorkspaceTabLaunch).toHaveBeenCalledWith(workspaceTabs[0]);
  });

  it('requires confirmation before deleting a saved preset', async () => {
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ workspaceTabs, onWorkspaceTabsChange });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    const deleteButton = screen.getByRole('button', { name: /delete preset janet dev/i });
    fireEvent.click(deleteButton);

    expect(onWorkspaceTabsChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: /delete preset “janet dev”/i })).toBeInTheDocument();
    expect(screen.getByText(/permanently deletes the saved preset/i)).toBeInTheDocument();
    expect(screen.getByText(/existing terminal tabs will stay open/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onWorkspaceTabsChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    fireEvent.click(deleteButton);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onWorkspaceTabsChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole('button', { name: /^delete preset$/i }));

    expect(onWorkspaceTabsChange).toHaveBeenCalledOnce();
    expect(onWorkspaceTabsChange).toHaveBeenCalledWith([]);
  });

  it('moves focus to New preset after the deleted preset row disappears', async () => {
    function Harness() {
      const [presets, setPresets] = useState(workspaceTabs);
      return (
        <VerticalTabBar
          tabs={tabs}
          activeTabId="tab-1"
          sshProfiles={sshProfiles}
          workspaceTabs={presets}
          onSelectTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewTab={vi.fn()}
          sshConnectionsOpen={false}
          onSSHConnectionsOpenChange={vi.fn()}
          onSSHConnected={vi.fn()}
          onSSHProfilesChange={vi.fn()}
          onWorkspaceTabsChange={setPresets}
          onWorkspaceTabLaunch={vi.fn()}
          onSaveWorkspaceTab={vi.fn()}
          onRenameTab={vi.fn()}
          onCollapse={vi.fn()}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    const remove = screen.getByRole('button', { name: /delete preset janet dev/i });
    act(() => remove.focus());
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /delete preset janet dev/i })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'New preset' })).toHaveFocus());
  });

  it('presets section is collapsed by default', () => {
    renderTabs({ workspaceTabs });

    // Section header exists but content is not rendered
    expect(screen.getByRole('button', { name: /^presets$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new preset/i })).not.toBeInTheDocument();
  });

  it('focuses the workspace form and restores the opener on Escape', async () => {
    renderTabs();

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    const opener = screen.getByRole('button', { name: /new preset/i });
    opener.focus();
    fireEvent.click(opener);

    const nameInput = screen.getByRole('textbox', { name: /preset name/i });
    await waitFor(() => expect(nameInput).toHaveFocus());
    fireEvent.keyDown(nameInput, { key: 'Escape' });

    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves secondary tab actions into a context menu', () => {
    const onRenameTab = vi.fn();
    const onSaveWorkspaceTab = vi.fn();
    renderTabs({ onRenameTab, onSaveWorkspaceTab });

    expect(screen.queryByRole('button', { name: /rename tab/i })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getAllByRole('button', { name: /^close /i })[0].closest('.vtab-item')!);
    expect(screen.getByRole('menu').parentElement).toBe(document.body);
    fireEvent.click(screen.getByRole('menuitem', { name: /rename tab/i }));
    const nameInput = screen.getByRole('textbox', { name: /^tab name$/i });
    expect(nameInput).toHaveAttribute('maxlength', '256');
    fireEvent.change(nameInput, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save tab name/i }));

    expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'Renamed');

    fireEvent.contextMenu(screen.getAllByRole('button', { name: /^close /i })[0].closest('.vtab-item')!);
    fireEvent.click(screen.getByRole('menuitem', { name: /save as preset/i }));
    expect(onSaveWorkspaceTab).toHaveBeenCalledWith(tabs[0]);
  });

  it('labels saving a linked tab as a preset update', () => {
    const linkedTab = { ...tabs[0], workspaceId: workspaceTabs[0].id };
    renderTabs({ tabs: [linkedTab], workspaceTabs });

    fireEvent.contextMenu(screen.getByRole('button', { name: /^close /i }).closest('.vtab-item')!);
    expect(screen.getByRole('menuitem', { name: 'Update saved preset' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Save as preset' })).not.toBeInTheDocument();
  });

  it('closes the tab context menu when clicking outside it', () => {
    renderTabs();

    fireEvent.contextMenu(screen.getAllByRole('button', { name: /^close /i })[0].closest('.vtab-item')!);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
      tabs={[{ ...readyTab, sshShellReady: false }]} activeTabId="tab-2" sshProfiles={sshProfiles} workspaceTabs={[]}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()} sshConnectionsOpen={false}
      onSSHConnectionsOpenChange={vi.fn()} onSSHConnected={vi.fn()} onSSHProfilesChange={vi.fn()}
      onWorkspaceTabsChange={vi.fn()} onWorkspaceTabLaunch={vi.fn()} onSaveWorkspaceTab={vi.fn()}
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
      tabs={[{ ...readyTab, sshShellReady: false }]} activeTabId="tab-2" sshProfiles={sshProfiles} workspaceTabs={[]}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()} sshConnectionsOpen={false}
      onSSHConnectionsOpenChange={vi.fn()} onSSHConnected={vi.fn()} onSSHProfilesChange={vi.fn()}
      onWorkspaceTabsChange={vi.fn()} onWorkspaceTabLaunch={vi.fn()} onSaveWorkspaceTab={vi.fn()}
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

  it('forgets timestamps for removed tabs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-07-24T12:00:00Z'));
      function Harness() {
        const [visible, setVisible] = useState(true);
        return (
          <>
            <button type="button" onClick={() => setVisible(false)}>Remove tab</button>
            <button type="button" onClick={() => setVisible(true)}>Restore tab</button>
            <VerticalTabBar
              tabs={visible ? [tabs[0]] : []}
              activeTabId="tab-1"
              sshProfiles={sshProfiles}
              workspaceTabs={[]}
              onSelectTab={vi.fn()}
              onCloseTab={vi.fn()}
              onNewTab={vi.fn()}
              sshConnectionsOpen={false}
              onSSHConnectionsOpenChange={vi.fn()}
              onSSHConnected={vi.fn()}
              onSSHProfilesChange={vi.fn()}
              onWorkspaceTabsChange={vi.fn()}
              onWorkspaceTabLaunch={vi.fn()}
              onSaveWorkspaceTab={vi.fn()}
              onRenameTab={vi.fn()}
              onCollapse={vi.fn()}
            />
          </>
        );
      }

      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Remove tab' }));
      vi.setSystemTime(new Date('2026-07-24T14:00:00Z'));
      fireEvent.click(screen.getByRole('button', { name: 'Restore tab' }));

      await waitFor(() => expect(document.querySelector('.vtab-time')).toHaveTextContent('just now'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes the active terminal tab to assistive technology', () => {
    renderTabs();

    expect(screen.getByRole('button', { name: /Main app Local/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /SSH box SSH/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'Terminal tabs' })).toBeInTheDocument();
  });

  it('uses the aggregate agent status as the compact tab subtitle', () => {
    const status: AgentStatus = { kind: 'finished', label: 'Hermes · Turn finished' };
    renderTabs({ awarenessByTab: { 'tab-2': status } });

    expect(screen.getByText('Hermes · Turn finished')).toHaveClass('vtab-sub', 'finished');
    expect(screen.getByRole('button', { name: /SSH box Hermes · Turn finished/i })).toBeInTheDocument();
  });

  it('explains why an SSH preset cannot be created without a saved connection', () => {
    renderTabs({ sshProfiles: [] });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /new preset/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /preset name/i }), { target: { value: 'Remote' } });
    fireEvent.click(screen.getByRole('button', { name: 'SSH connection' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Terminal 1 needs a saved SSH connection.');
    expect(screen.getByRole('button', { name: /^create preset$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Terminal 1 SSH profile' }));
    expect(screen.getByRole('option', { name: 'No saved SSH connections' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps a preset with a deleted SSH connection recoverable', () => {
    const presetWithDeletedConnection: WorkspaceTabPreset = {
      id: 'ws-deleted-ssh',
      name: 'Old server',
      type: 'local',
      root: { type: 'leaf', terminalType: 'ssh', sshProfileId: 'deleted@server:22:password' },
      terminalCount: 1,
      splitDirection: 'vertical',
    };
    renderTabs({ workspaceTabs: [presetWithDeletedConnection], sshProfiles: [] });

    fireEvent.click(screen.getByRole('button', { name: /^presets$/i }));
    fireEvent.click(screen.getByRole('button', { name: /edit preset old server/i }));

    expect(screen.getByText('Missing saved connection')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Terminal 1 needs a saved SSH connection.');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  it('collapses the tabs panel', () => {
    const onCollapse = vi.fn();
    renderTabs({ onCollapse });

    fireEvent.click(screen.getByRole('button', { name: /collapse terminal tabs/i }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
