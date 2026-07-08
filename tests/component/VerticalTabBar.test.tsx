import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
    />,
  );
}

describe('VerticalTabBar', () => {
  it('shows a close action even when there is only one tab', () => {
    renderTabs({ tabs: [tabs[0]] });

    expect(screen.getByRole('button', { name: /close tab/i })).toBeInTheDocument();
  });

  it('labels the section as Tabs and creates new tabs from the header', () => {
    const onNewTab = vi.fn();
    renderTabs({ onNewTab });

    expect(screen.getByText('Tabs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^new tab$/i }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it('creates a saved workspace preset from the workspaces section', () => {
    const onWorkspaceTabsChange = vi.fn();
    renderTabs({ onWorkspaceTabsChange });

    // Expand the workspaces section first (collapsed by default)
    fireEvent.click(screen.getByRole('button', { name: /^workspaces$/i }));

    fireEvent.click(screen.getByRole('button', { name: /save workspace preset/i }));
    fireEvent.change(screen.getByPlaceholderText(/tab name/i), { target: { value: 'JaneT workspace' } });
    fireEvent.change(screen.getByPlaceholderText(/directory path/i), { target: { value: '~/projects/janet' } });
    fireEvent.click(screen.getByRole('button', { name: /add workspace preset/i }));

    expect(onWorkspaceTabsChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        name: 'JaneT workspace',
        type: 'local',
        cwd: '~/projects/janet',
        terminalCount: 1,
        splitDirection: 'vertical',
      }),
    ]));
  });

  it('launches a workspace preset from the workspaces section', () => {
    const onWorkspaceTabLaunch = vi.fn();
    renderTabs({ workspaceTabs, onWorkspaceTabLaunch });

    fireEvent.click(screen.getByRole('button', { name: /^workspaces$/i }));
    fireEvent.click(screen.getByRole('button', { name: /open janet dev/i }));

    expect(onWorkspaceTabLaunch).toHaveBeenCalledWith(workspaceTabs[0]);
  });

  it('workspaces section is collapsed by default', () => {
    renderTabs({ workspaceTabs });

    // Section header exists but content is not rendered
    expect(screen.getByRole('button', { name: /^workspaces$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save workspace preset/i })).not.toBeInTheDocument();
  });

  it('renames tabs inline', () => {
    const onRenameTab = vi.fn();
    renderTabs({ onRenameTab });

    fireEvent.click(screen.getAllByRole('button', { name: /rename tab/i })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /^tab name$/i }), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save tab name/i }));

    expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'Renamed');
  });

  it('shows scan-friendly subtitles for local and SSH tabs', () => {
    renderTabs();

    expect(screen.getByText('Local · repo')).toBeInTheDocument();
    expect(screen.getByText('SSH · pckpr@box.local:22')).toBeInTheDocument();
  });

  it('collapses the tabs panel', () => {
    const onCollapse = vi.fn();
    renderTabs({ onCollapse });

    fireEvent.click(screen.getByRole('button', { name: /collapse tabs/i }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
