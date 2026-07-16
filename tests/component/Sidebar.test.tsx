import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Sidebar, { SidebarProps, WorkspaceToolSection } from '../../src/renderer/components/Sidebar';
import type { FileExplorerSource } from '../../src/renderer/fileExplorerSource';

const childSpies = vi.hoisted(() => ({
  fileExplorer: vi.fn(),
  gitTree: vi.fn(),
}));

vi.mock('../../src/renderer/components/FileExplorer', () => ({
  default: (props: unknown) => {
    childSpies.fileExplorer(props);
    return <div data-testid="file-explorer">File explorer</div>;
  },
}));

vi.mock('../../src/renderer/components/GitTree', () => ({
  default: (props: unknown) => {
    childSpies.gitTree(props);
    return <div data-testid="git-tree">Git tree</div>;
  },
}));

const explorerSource: FileExplorerSource = {
  kind: 'local',
  key: 'local:/workspace/janet',
  cwd: '/workspace/janet',
  ready: true,
};

function makeProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    section: 'files',
    onSectionChange: vi.fn(),
    side: 'left',
    expanded: true,
    onExpandedChange: vi.fn(),
    explorerSource,
    cwdReady: true,
    isRemote: false,
    gitRepository: {
      repoPath: '/workspace/janet',
      status: null,
      searching: false,
    },
    onOpenLocalTabAt: vi.fn(),
    ...overrides,
  };
}

function ControlledSidebar({
  initialSection = 'files',
  initialExpanded = true,
}: {
  initialSection?: WorkspaceToolSection;
  initialExpanded?: boolean;
}) {
  const [section, setSection] = useState<WorkspaceToolSection>(initialSection);
  const [expanded, setExpanded] = useState(initialExpanded);
  return (
    <Sidebar
      {...makeProps()}
      section={section}
      onSectionChange={setSection}
      expanded={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

describe('Sidebar workspace tools', () => {
  beforeEach(() => {
    childSpies.fileExplorer.mockClear();
    childSpies.gitTree.mockClear();
  });

  it('exposes a data-driven tool switcher with exactly one active view', () => {
    render(<ControlledSidebar />);

    expect(screen.getByRole('heading', { name: 'Workspace tools' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tool views' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('tab').filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(screen.getByTestId('file-explorer')).toBeInTheDocument();
    expect(screen.queryByTestId('git-tree')).toBeNull();
  });

  it.each([
    ['left', 'rail', 'panel'],
    ['right', 'panel', 'rail'],
  ] as const)('places the tool selector on the outside edge when docked %s', (side, first, last) => {
    const { container } = render(<Sidebar {...makeProps({ side })} />);
    const tools = screen.getByRole('complementary', { name: 'Workspace tools' });
    const body = container.querySelector('.workspace-tools-body');
    const rail = screen.getByRole('tablist', { name: 'Workspace tool views' });
    const panel = screen.getByRole('tabpanel');
    const elements = { rail, panel };

    expect(tools).toHaveClass(`workspace-tools-side-${side}`);
    expect(body?.firstElementChild).toBe(elements[first]);
    expect(body?.lastElementChild).toBe(elements[last]);
  });

  it('moves the active panel without remounting it when the dock side changes', () => {
    const { rerender } = render(<Sidebar {...makeProps({ side: 'right' })} />);
    const explorer = screen.getByTestId('file-explorer');
    explorer.setAttribute('tabindex', '0');
    explorer.focus();

    rerender(<Sidebar {...makeProps({ side: 'left' })} />);

    expect(screen.getByTestId('file-explorer')).toBe(explorer);
    expect(explorer).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches the active panel from a workspace tool button', () => {
    render(<ControlledSidebar />);

    fireEvent.click(screen.getByRole('tab', { name: 'Source Control' }));

    expect(screen.getByRole('tab', { name: 'Explorer' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'workspace-tool-tab-git');
    expect(screen.getByTestId('git-tree')).toBeInTheDocument();
    expect(screen.queryByTestId('file-explorer')).toBeNull();
  });

  it('supports vertical tab keyboard navigation', () => {
    render(<ControlledSidebar />);
    const explorer = screen.getByRole('tab', { name: 'Explorer' });

    explorer.focus();
    fireEvent.keyDown(explorer, { key: 'ArrowDown' });

    expect(screen.getByRole('tab', { name: 'Source Control' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('git-tree')).toBeInTheDocument();
  });

  it('keeps the tool rail accessible when collapsed and expands the selected view', () => {
    render(<ControlledSidebar initialExpanded={false} />);

    expect(screen.getByRole('complementary', { name: 'Workspace tools' })).toHaveClass('is-collapsed');
    expect(screen.getByRole('button', { name: 'Expand workspace tools' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('tab', { name: 'Explorer' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Source Control' })).toBeVisible();
    expect(screen.getByRole('tabpanel', { hidden: true })).not.toBeVisible();
    expect(screen.queryByTestId('file-explorer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('git-tree')).not.toBeInTheDocument();
    expect(childSpies.fileExplorer).not.toHaveBeenCalled();
    expect(childSpies.gitTree).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Source Control' }));

    expect(screen.getByRole('complementary', { name: 'Workspace tools' })).toHaveClass('is-expanded');
    expect(screen.getByRole('button', { name: 'Collapse workspace tools' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tab', { name: 'Source Control' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeVisible();
    expect(screen.getByTestId('git-tree')).toBeInTheDocument();
  });

  it('uses the dedicated control to collapse the active tool panel', () => {
    const onExpandedChange = vi.fn();
    render(<Sidebar {...makeProps({ onExpandedChange })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse workspace tools' }));

    expect(onExpandedChange).toHaveBeenCalledOnce();
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('forwards the active terminal filesystem to Explorer', () => {
    render(<Sidebar {...makeProps()} />);

    expect(childSpies.fileExplorer).toHaveBeenLastCalledWith({ source: explorerSource });
  });

  it('forwards repository state and local-tab navigation to Source Control', () => {
    const status = {
      current: 'main',
      files: [],
      ahead: 0,
      behind: 1,
      created: [],
      modified: [],
      deleted: [],
      conflicted: [],
    };
    const onOpenLocalTabAt = vi.fn();
    render(
      <Sidebar
        {...makeProps({
          section: 'git',
          cwdReady: false,
          isRemote: true,
          gitRepository: {
            repoPath: '/workspace/repository',
            status,
            searching: true,
          },
          onOpenLocalTabAt,
        })}
      />,
    );

    expect(childSpies.gitTree).toHaveBeenLastCalledWith({
      cwdReady: false,
      isRemote: true,
      repoPath: '/workspace/repository',
      status,
      searching: true,
      onOpenLocalTabAt,
    });
  });
});
