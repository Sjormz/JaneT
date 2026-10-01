import React from 'react';
import FileExplorer from './FileExplorer';
import GitTree from './GitTree';
import Tooltip from './Tooltip';
import {
  SidebarCollapseLeftIcon,
  SidebarCollapseRightIcon,
  FilesIcon,
  SourceControlIcon,
} from '../icons';
import { GitRepositoryState } from '../useGitRepository';
import type { FileExplorerSource } from '../fileExplorerSource';
import type { EditorResource } from '../editorDocuments';
import { useGlidingSelection } from './motion';

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
  gitRepository: GitRepositoryState;
  openLocalTerminals?: Array<{ terminalId: string; cwd: string; lastFocused: number }>;
  onOpenTerminal?: (terminalId: string) => void;
  /** Open a Git worktree as a Library project (or focus its existing project). */
  onOpenWorktree?: (worktreePath: string, repoPath: string | null) => void;
  onCopyTerminalPath?: (path: string) => Promise<void>;
  onOpenFile?: (resource: EditorResource) => void;
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
  gitRepository,
  openLocalTerminals,
  onOpenTerminal,
  onOpenWorktree,
  onCopyTerminalPath,
  onOpenFile,
}: SidebarProps) {
  const gitMutationLock = React.useRef<{ repoPath: string } | null>(null);
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

  const toolRailRef = React.useRef<HTMLDivElement>(null);
  useGlidingSelection(toolRailRef, '.workspace-tool-button.active', section);

  const toolRail = (
    <div
      key="workspace-tools-rail"
      ref={toolRailRef}
      className="workspace-tools-rail"
      role="tablist"
      aria-label="Project tool views"
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
          <FileExplorer
            source={explorerSource}
            onCopyTerminalPath={onCopyTerminalPath}
            onOpenFile={onOpenFile}
          />
        ) : (
          <GitTree
            cwdReady={cwdReady}
            repoPath={gitRepository.repoPath}
            status={gitRepository.status}
            searching={gitRepository.searching}
            statusError={gitRepository.error}
            openLocalTerminals={openLocalTerminals}
            onOpenTerminal={onOpenTerminal}
            onOpenWorktree={onOpenWorktree}
            onCopyTerminalPath={onCopyTerminalPath}
            onOpenFile={onOpenFile}
            mutationLock={gitMutationLock}
          />
        )
      )}
    </div>
  );

  return (
    <aside
      className={`sidebar workspace-tools workspace-supporting-rail workspace-tools-side-${side} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      aria-label="Project tools"
    >
      {/* Each tool panel carries its own title; this heading names the region for assistive technology. */}
      <h2 className="workspace-tools-title sr-only">Project tools</h2>

      <div className="workspace-tools-body">
        {side === 'left' ? [toolRail, toolPanel] : [toolPanel, toolRail]}
      </div>
      {/* Outside the tablist (only tabs belong there); styled to sit at the foot of the tool rail. */}
      <Tooltip label={expanded ? 'Collapse project tools' : 'Expand project tools'} placement={side === 'left' ? 'right' : 'left'}>
        <button
          type="button"
          className="workspace-tool-button project-tools-collapse"
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse project tools' : 'Expand project tools'}
          onClick={() => onExpandedChange(!expanded)}
        >
          {(side === 'right') === expanded ? <SidebarCollapseRightIcon size="sm" /> : <SidebarCollapseLeftIcon size="sm" />}
        </button>
      </Tooltip>
    </aside>
  );
}
