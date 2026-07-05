import { describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import VerticalTabBar from '../../src/renderer/components/VerticalTabBar';
import { TabInfo } from '../../src/renderer/types';

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
    root: { id: 'split-2', type: 'split', direction: 'vertical', children: [{ id: 'term-2', type: 'leaf' }], sizes: [1] },
  },
];

function renderTabs(overrides?: Partial<React.ComponentProps<typeof VerticalTabBar>>) {
  return render(
    <VerticalTabBar
      tabs={tabs}
      activeTabId="tab-1"
      onSelectTab={vi.fn()}
      onCloseTab={vi.fn()}
      onNewTab={vi.fn()}
      onRenameTab={vi.fn()}
      onCollapse={vi.fn()}
      {...overrides}
    />,
  );
}

describe('VerticalTabBar', () => {
  it('labels the section as Tabs and creates new tabs from the header', () => {
    const onNewTab = vi.fn();
    renderTabs({ onNewTab });

    expect(screen.getByText('Tabs')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new tab/i }));
    expect(onNewTab).toHaveBeenCalledOnce();
  });

  it('renames tabs inline', () => {
    const onRenameTab = vi.fn();
    renderTabs({ onRenameTab });

    fireEvent.click(screen.getAllByRole('button', { name: /rename tab/i })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /^tab name$/i }), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /save tab name/i }));

    expect(onRenameTab).toHaveBeenCalledWith('tab-1', 'Renamed');
  });

  it('collapses the tabs panel', () => {
    const onCollapse = vi.fn();
    renderTabs({ onCollapse });

    fireEvent.click(screen.getByRole('button', { name: /collapse tabs/i }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
