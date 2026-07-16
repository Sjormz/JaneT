import React from 'react';
import FileExplorer from './FileExplorer';
import GitTree from './GitTree';
import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  FilesIcon,
  SourceControlIcon,
} from '../icons';
import { GitRepositoryState } from '../useGitRepository';
import type { FileExplorerSource } from '../fileExplorerSource';

export type WorkspaceToolSection = 'files' | 'git';

export interface SidebarProps {
  section: WorkspaceToolSection;
  onSectionChange: (section: WorkspaceToolSection) => void;
  side: 'left' | 'right';
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Filesystem currently owned by the focused terminal pane. */
  explorerSource: FileExplorerSource;
  /** True once we have a usable cwd to show. */
  cwdReady: boolean;
  /** True if the active tab is an SSH tab. Source Control shows a notice. */
  isRemote: boolean;
  gitRepository: GitRepositoryState;
  onOpenLocalTabAt?: (cwd: string, title?: string) => void;
  onCopyTerminalPath?: (path: string) => Promise<void>;
}

interface WorkspaceToolDefinition {
  id: WorkspaceToolSection;
  label: string;
  Icon: React.ComponentType;
}

const WORKSPACE_TOOLS: readonly WorkspaceToolDefinition[] = [
  { id: 'files', label: 'Explorer', Icon: FilesIcon },
  { id: 'git', label: 'Source Control', Icon: SourceControlIcon },
];

export default function Sidebar({
  section,
  onSectionChange,
  side,
  expanded,
  onExpandedChange,
  explorerSource,
  cwdReady,
  isRemote,
  gitRepository,
  onOpenLocalTabAt,
  onCopyTerminalPath,
}: SidebarProps) {
  const activeTool = WORKSPACE_TOOLS.find((tool) => tool.id === section) ?? WORKSPACE_TOOLS[0];
  const panelId = 'workspace-tools-panel';

  const selectTool = (nextSection: WorkspaceToolSection) => {
    onSectionChange(nextSection);
    if (!expanded) onExpandedChange(true);
  };

  const handleToolKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % WORKSPACE_TOOLS.length;
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + WORKSPACE_TOOLS.length) % WORKSPACE_TOOLS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = WORKSPACE_TOOLS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTool = WORKSPACE_TOOLS[nextIndex];
    selectTool(nextTool.id);
    document.getElementById(`workspace-tool-tab-${nextTool.id}`)?.focus();
  };

  const toolRail = (
    <div
      key="workspace-tools-rail"
      className="workspace-tools-rail"
      role="tablist"
      aria-label="Workspace tool views"
      aria-orientation="vertical"
    >
      {WORKSPACE_TOOLS.map(({ id, label, Icon }, index) => {
        const active = id === section;
        return (
          <button
            key={id}
            id={`workspace-tool-tab-${id}`}
            type="button"
            role="tab"
            className={`workspace-tool-button${active ? ' active' : ''}`}
            aria-selected={active}
            aria-controls={panelId}
            aria-label={label}
            title={label}
            tabIndex={active ? 0 : -1}
            onClick={() => selectTool(id)}
            onKeyDown={(event) => handleToolKeyDown(event, index)}
          >
            <Icon />
            <span className="workspace-tool-label">{label}</span>
          </button>
        );
      })}
    </div>
  );

  const toolPanel = (
    <div
      key="workspace-tools-panel"
      id={panelId}
      className="workspace-tools-panel sidebar-content"
      role="tabpanel"
      aria-labelledby={`workspace-tool-tab-${activeTool.id}`}
      hidden={!expanded}
    >
      {expanded && (
        activeTool.id === 'files' ? (
          <FileExplorer source={explorerSource} onCopyTerminalPath={onCopyTerminalPath} />
        ) : (
          <GitTree
            cwdReady={cwdReady}
            isRemote={isRemote}
            repoPath={gitRepository.repoPath}
            status={gitRepository.status}
            searching={gitRepository.searching}
            onOpenLocalTabAt={onOpenLocalTabAt}
            onCopyTerminalPath={onCopyTerminalPath}
          />
        )
      )}
    </div>
  );

  return (
    <aside
      className={`sidebar workspace-tools workspace-tools-side-${side} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="Workspace tools"
    >
      <div className="workspace-tools-header">
        <h2 className="workspace-tools-title">Workspace tools</h2>
        <button
          type="button"
          className="workspace-tools-toggle"
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse workspace tools' : 'Expand workspace tools'}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? <ChevronsLeftIcon size="md" /> : <ChevronsRightIcon size="md" />}
        </button>
      </div>

      <div className="workspace-tools-body">
        {side === 'left' ? [toolRail, toolPanel] : [toolPanel, toolRail]}
      </div>
    </aside>
  );
}
