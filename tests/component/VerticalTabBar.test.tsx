import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VerticalTabBar from '../../src/renderer/components/VerticalTabBar';
import { SavedSSHProfile, TabInfo, WorkspaceTabPreset } from '../../src/renderer/types';

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

  it('labels the section as Tabs and creates new tabs from the header', () => {
    const onNewTab = vi.fn();
    renderTabs({ onNewTab });

    expect(screen.getByText('Tabs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^new terminal tab$/i }));
    expect(onNewTab).toHaveBeenCalledOnce();
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
    fireEvent.change(screen.getByRole('textbox', { name: /^tab name$/i }), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save tab name/i }));

    expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'Renamed');

    fireEvent.contextMenu(screen.getAllByRole('button', { name: /^close /i })[0].closest('.vtab-item')!);
    fireEvent.click(screen.getByRole('menuitem', { name: /save as preset/i }));
    expect(onSaveWorkspaceTab).toHaveBeenCalledWith(tabs[0]);
  });

  it('closes the tab context menu when clicking outside it', () => {
    renderTabs();

    fireEvent.contextMenu(screen.getAllByRole('button', { name: /^close /i })[0].closest('.vtab-item')!);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
    expect(screen.getByRole('group', { name: 'Terminal tabs' })).toBeInTheDocument();
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
