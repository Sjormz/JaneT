import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon,
  GitCommitIcon, SourceControlIcon as GitBranchIcon, GitMergeIcon,
  TrashIcon, AlertIcon, CircleDotIcon, CircleIcon, FolderIcon,
  fileIconFor,
  SettingsIconCmp, MoreIcon, ListIcon, ArrowUpIcon, ArrowDownIcon,
} from '../icons';
import { defaultWorktreePath, GitWorktreeInfo, basename } from '../../shared/gitWorktrees';
import { refreshCoordinator, useRefreshTask } from '../refreshCoordinator';
import { GitStatusResult } from '../useGitRepository';
import { useModalFocus } from '../useModalFocus';
import { beginTerminalPathDrag, endTerminalPathDrag, resolveRepositoryPath } from '../terminalPathDrag';
import TerminalPathCopyButton from './TerminalPathCopyButton';
import Tooltip from './Tooltip';
import type { EditorResource } from '../editorDocuments';

interface GitBranchInfo {
  name: string;
  current: boolean;
  label: string;
  worktreePath?: string;
  isRemote: boolean;
  remote?: string;
}

interface GitTreeProps {
  cwdReady: boolean;
  isRemote: boolean;
  repoPath: string | null;
  status: GitStatusResult | null;
  searching: boolean;
  onOpenLocalTabAt?: (cwd: string, title?: string) => void;
  onCopyTerminalPath?: (path: string) => Promise<void>;
  onOpenFile?: (resource: EditorResource) => void;
}

type Section = 'branches' | 'changes' | 'worktrees';

interface DialogField {
  key: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
}

interface DialogState {
  title: string;
  description?: string;
  fields: DialogField[];
  confirmLabel: string;
  destructive?: boolean;
  onSubmit: (values: Record<string, string>) => void;
}

export default function GitTree({
  cwdReady,
  isRemote,
  repoPath,
  status,
  searching,
  onOpenLocalTabAt,
  onCopyTerminalPath,
  onOpenFile,
}: GitTreeProps) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([]);
  const [expanded, setExpanded] = useState<Record<Section, boolean>>({
    changes: true,
    worktrees: true,
    branches: true,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [worktreeBaseDir, setWorktreeBaseDir] = useState('../');
  const [worktreeTemplate, setWorktreeTemplate] = useState('{repo}-{branch}');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [changesView, setChangesView] = useState<'flat' | 'tree'>('flat');
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);
  const detailsGeneration = useRef(0);
  const observedBranch = useRef<{ repoPath: string | null; branch: string | null }>({
    repoPath: null,
    branch: null,
  });

  useEffect(() => {
    window.janet.getSettings().then((settings: any) => {
      setWorktreeBaseDir(settings.gitWorktreeBaseDir || '../');
      setWorktreeTemplate(settings.gitWorktreeNameTemplate || '{repo}-{branch}');
    }).catch(() => {});
  }, []);

  const loadGitDetails = useCallback(async (repo: string) => {
    const generation = ++detailsGeneration.current;
    try {
      const details = await window.janet.gitDetails({ repoPath: repo });
      if (generation !== detailsGeneration.current) return;
      setBranches(details?.branches || []);
      setWorktrees(details?.worktrees || []);
    } catch {
      if (generation === detailsGeneration.current) setMessage('Couldn’t load Source Control data');
    }
  }, []);

  useEffect(() => {
    detailsGeneration.current += 1;
    setBranches([]);
    setWorktrees([]);
    setMessage(null);
  }, [repoPath]);

  useRefreshTask({
    key: `git-details:${repoPath || 'none'}`,
    intervalMs: 10_000,
    enabled: Boolean(repoPath) && cwdReady && !isRemote,
    run: () => repoPath ? loadGitDetails(repoPath) : undefined,
  });

  useEffect(() => {
    const branch = status?.current || null;
    const previous = observedBranch.current;
    observedBranch.current = { repoPath, branch };
    if (repoPath && branch && previous.repoPath === repoPath && previous.branch && previous.branch !== branch) {
      refreshCoordinator.invalidate('mutation', `git-details:${repoPath}`);
    }
  }, [repoPath, status?.current]);

  const runGitAction = async (action: () => Promise<boolean>, success: string) => {
    if (!repoPath) return;
    setBusy(true);
    setMessage(null);
    detailsGeneration.current += 1;
    try {
      const ok = await action();
      setMessage(ok ? success : 'Git action failed');
      if (ok) refreshCoordinator.invalidate('mutation');
    } catch (err: any) {
      setMessage(err?.message || 'Git action failed');
    } finally {
      setBusy(false);
    }
  };

  // === Dialog-based actions (no window.prompt/confirm — unsupported in Electron) ===

  const handleCreateBranch = () => {
    if (!repoPath) return;
    setDialog({
      title: 'Create branch',
      confirmLabel: 'Create',
      fields: [
        { key: 'branch', label: 'Branch name', placeholder: 'feature/my-branch' },
        { key: 'startPoint', label: 'Start point (blank = HEAD)', placeholder: status?.current || 'HEAD', defaultValue: '' },
      ],
      onSubmit: (v) => {
        if (!v.branch?.trim()) return;
        runGitAction(
          () => window.janet.gitCreateBranch({ repoPath, branch: v.branch.trim(), startPoint: v.startPoint?.trim() || undefined, checkout: true }),
          `Created ${v.branch.trim()}`,
        );
      },
    });
  };

  const handleDeleteBranch = (branch: GitBranchInfo) => {
    const isCurrent = status?.current ? branch.name === status.current : branch.current;
    if (!repoPath || isCurrent) return;
    setDialog({
      title: `Delete ${branch.name}`,
      confirmLabel: 'Delete',
      destructive: true,
      fields: [
        { key: 'force', label: 'Type FORCE to delete even with unmerged work. Leave blank for a safe delete.', placeholder: '' },
      ],
      onSubmit: (v) => {
        const force = v.force?.trim().toUpperCase() === 'FORCE';
        runGitAction(
          () => window.janet.gitDeleteBranch({ repoPath, branch: branch.name, force }),
          `Deleted ${branch.name}`,
        );
      },
    });
  };

  const handleCheckout = (branchName: string) => {
    if (!repoPath) return;
    runGitAction(() => window.janet.gitCheckout({ repoPath, branch: branchName }), `Switched to ${branchName}`);
  };

  const persistWorktreeSettings = (baseDir: string, template: string) => {
    setWorktreeBaseDir(baseDir);
    setWorktreeTemplate(template);
    window.janet.setSettings({ gitWorktreeBaseDir: baseDir, gitWorktreeNameTemplate: template }).catch(() => {});
  };

  const handleWorktreeSettings = () => {
    setDialog({
      title: 'Worktree defaults',
      confirmLabel: 'Save',
      fields: [
        { key: 'baseDir', label: 'Base directory', placeholder: '../', defaultValue: worktreeBaseDir },
        { key: 'template', label: 'Folder template', placeholder: '{repo}-{branch}', defaultValue: worktreeTemplate },
      ],
      onSubmit: (v) => {
        persistWorktreeSettings(v.baseDir?.trim() || '../', v.template?.trim() || '{repo}-{branch}');
      },
    });
  };

  const handleAddWorktree = (createBranch: boolean) => {
    if (!repoPath) return;
    setDialog({
      title: createBranch ? 'Add worktree with new branch' : 'Add worktree from existing branch',
      confirmLabel: 'Add',
      fields: [
        { key: 'branch', label: createBranch ? 'New branch name' : 'Existing branch', placeholder: 'feature/my-branch' },
        { key: 'path', label: 'Worktree directory', placeholder: '' },
        ...(createBranch ? [{ key: 'startPoint', label: 'Start point (blank = HEAD)', placeholder: status?.current || 'HEAD', defaultValue: '' }] : []),
      ],
      onSubmit: (v) => {
        if (!v.branch?.trim() || !v.path?.trim()) return;
        runGitAction(
          () => window.janet.gitAddWorktree({
            repoPath,
            worktreePath: v.path.trim(),
            branch: v.branch.trim(),
            createBranch,
            startPoint: v.startPoint?.trim() || undefined,
          }),
          `Added worktree ${v.branch.trim()}`,
        );
      },
    });
  };

  // Auto-suggest worktree path when branch field changes
  useEffect(() => {
    if (!dialog || !repoPath) return;
    const branchField = dialog.fields.find((f) => f.key === 'branch');
    const pathField = dialog.fields.find((f) => f.key === 'path');
    if (!branchField || !pathField) return;
    // Can't mutate dialog.fields directly; the GitDialog component manages its own input state.
  }, [dialog, repoPath]);

  const handleRemoveWorktree = (tree: GitWorktreeInfo) => {
    if (!repoPath || tree.path === repoPath) return;
    setDialog({
      title: `Remove ${basename(tree.path)}`,
      description: `Remove the Git worktree at ${tree.path}. This deletes that worktree directory; uncommitted files are preserved only if Git refuses the safe removal.`,
      confirmLabel: 'Remove',
      destructive: true,
      fields: [
        { key: 'force', label: 'Type FORCE to remove even with local changes. Leave blank for a safe removal.', placeholder: '' },
      ],
      onSubmit: (v) => {
        const force = v.force?.trim().toUpperCase() === 'FORCE';
        runGitAction(
          () => window.janet.gitRemoveWorktree({ repoPath, worktreePath: tree.path, force }),
          `Removed ${tree.path}`,
        );
      },
    });
  };

  const handlePruneWorktrees = () => {
    if (!repoPath) return;
    setDialog({
      title: 'Prune stale worktrees',
      description: 'Remove Git records for worktrees whose directories no longer exist. Working directories are not deleted.',
      confirmLabel: 'Prune',
      destructive: true,
      fields: [],
      onSubmit: () => {
        runGitAction(() => window.janet.gitPruneWorktrees({ repoPath }), 'Pruned stale worktrees');
      },
    });
  };

  const toggle = (section: Section) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  if (searching) return shell('Searching for Git repositories…');
  if (isRemote) return shell('Source Control is available for local terminals', 'Open a local terminal in a Git repository to manage changes, branches, and worktrees.');
  if (!repoPath) return shell('No Git repository found', 'Open a local terminal in a Git repository to see changes, branches, and worktrees.');

  return (
    <div className="git-tree">
      <div className="git-header">
        <span className="section-title">Source Control</span>
        <Tooltip label="Refresh Source Control" placement="left">
          <button className="icon-btn" onClick={() => refreshCoordinator.invalidate('manual')} disabled={busy} aria-label="Refresh Source Control">
            <RefreshIcon size="sm" />
          </button>
        </Tooltip>
      </div>

      <Tooltip label={repoPath} placement="right">
        <div className="git-repo-path" aria-label={`${status?.current || 'HEAD'} at ${repoPath}`}>
          <GitBranchIcon size="xs" /> {status?.current || 'HEAD'}
          {status && status.files.length > 0 && <span className="git-pill dirty" aria-label={`${status.files.length} changed files`}><CircleIcon size="xs" /> {status.files.length}</span>}
          {status && status.ahead > 0 && <span className="git-pill ahead" aria-label={`${status.ahead} commits ahead`}><ArrowUpIcon size="xs" />{status.ahead}</span>}
          {status && status.behind > 0 && <span className="git-pill behind" aria-label={`${status.behind} commits behind`}><ArrowDownIcon size="xs" />{status.behind}</span>}
        </div>
      </Tooltip>
      {message && <div className="git-message">{message}</div>}

      {status && (
        <GitSection title="Changes" count={status.files.length} expanded={expanded.changes} onToggle={() => toggle('changes')}
          extra={status.files.length > 0 && (
            <Tooltip label={changesView === 'flat' ? 'Show changes as a folder tree' : 'Show changes as a flat list'} placement="left">
              <button
                className="git-view-toggle"
                onClick={(e) => { e.stopPropagation(); setChangesView(v => v === 'flat' ? 'tree' : 'flat'); }}
                aria-label={changesView === 'flat' ? 'Show changes as a folder tree' : 'Show changes as a flat list'}
              >
                {changesView === 'flat' ? <FolderIcon size="xs" /> : <ListIcon size="xs" />}
              </button>
            </Tooltip>
          )}
        >
          {status.files.length === 0 && <div className="git-empty">Working tree clean</div>}
          {status.files.length > 0 && changesView === 'tree' ? (
            <GitFileTree
              repoPath={repoPath}
              files={status.files}
              conflicted={status.conflicted}
              onCopyTerminalPath={onCopyTerminalPath}
              onOpenFile={onOpenFile}
            />
          ) : (
            status.files.map((file) => (
              <GitFile
                key={file.path}
                repoPath={repoPath}
                path={file.path}
                onCopyTerminalPath={onCopyTerminalPath}
                onOpenFile={onOpenFile}
                kind={status.conflicted.includes(file.path)
                  ? 'conflicted'
                  : file.staged && file.unstaged
                    ? 'mixed'
                    : file.staged
                      ? 'staged'
                      : 'unstaged'}
                wd={file.working_dir}
                index={file.index}
              />
            ))
          )}
        </GitSection>
      )}

<GitSection title="Worktrees" count={worktrees.length} expanded={expanded.worktrees} onToggle={() => toggle('worktrees')}
        extra={
          <div className="git-kebab-menu">
            <Tooltip label="Worktree actions" placement="left">
              <button className="git-view-toggle" onClick={(e) => { e.stopPropagation(); setWorktreeMenuOpen(o => !o); }} aria-label="Worktree actions"><MoreIcon size="xs" /></button>
            </Tooltip>
            {worktreeMenuOpen && (
              <>
                <div className="git-kebab-overlay" onClick={() => setWorktreeMenuOpen(false)} />
                <div className="git-kebab-dropdown">
                  <button className="git-kebab-item" onClick={() => { setWorktreeMenuOpen(false); handleWorktreeSettings(); }} disabled={busy}>
                    <SettingsIconCmp size="xs" /> Worktree defaults
                  </button>
                  <button className="git-kebab-item danger" onClick={() => { setWorktreeMenuOpen(false); handlePruneWorktrees(); }} disabled={busy}>
                    <TrashIcon size="xs" /> Prune stale worktrees…
                  </button>
                </div>
              </>
            )}
          </div>
        }
      >
        <div className="git-inline-actions">
          <button className="git-action-btn" onClick={() => handleAddWorktree(true)} disabled={busy}><PlusIcon size="xs" /> Add with new branch…</button>
          <button className="git-action-btn" onClick={() => handleAddWorktree(false)} disabled={busy}><PlusIcon size="xs" /> Add existing branch…</button>
        </div>
        {worktrees.map((tree) => (
          <div key={tree.path} className="git-worktree-item">
            <Tooltip label={`Open ${tree.path} in a terminal`} placement="right">
              <button className="git-row-main" onClick={() => onOpenLocalTabAt?.(tree.path, basename(tree.path))} aria-label={`Open worktree ${basename(tree.path)} in a terminal`}>
                <FolderIcon size="xs" />
                <span className="branch-name">{basename(tree.path)}</span>
                <span className="git-row-note">{tree.path === repoPath && status?.current ? status.current : tree.branch || 'detached'}</span>
              </button>
            </Tooltip>
            {tree.path !== repoPath && (
              <Tooltip label={`Remove worktree ${basename(tree.path)}`} placement="left">
                <button className="git-mini-btn danger" onClick={() => handleRemoveWorktree(tree)} disabled={busy} aria-label={`Remove worktree ${basename(tree.path)}`}><TrashIcon size="xs" /></button>
              </Tooltip>
            )}
          </div>
        ))}
      </GitSection>

<GitSection title="Branches" count={branches.length} expanded={expanded.branches} onToggle={() => toggle('branches')}>
        <div className="git-inline-actions">
          <button className="git-action-btn" onClick={handleCreateBranch} disabled={busy}><PlusIcon size="xs" /> Create branch…</button>
        </div>
        {branches.filter((b) => !b.isRemote).map((branch) => {
          const current = status?.current ? branch.name === status.current : branch.current;
          const DotIcon = current ? CircleDotIcon : CircleIcon;
          return (
            <div key={branch.name} className={`git-branch-item ${current ? 'current' : ''}`}>
              <Tooltip label={current ? `Current branch: ${branch.name}` : `Switch to branch ${branch.name}`} placement="right">
                <button
                  className="git-row-main"
                  onClick={() => !current && handleCheckout(branch.name)}
                  disabled={busy}
                  aria-disabled={current || undefined}
                  aria-label={current ? `Current branch ${branch.name}` : `Switch to branch ${branch.name}`}
                >
                  <DotIcon size="xs" className="branch-icon" />
                  <span className="branch-name">{branch.name}</span>
                  {branch.worktreePath && <span className="git-row-note">worktree</span>}
                </button>
              </Tooltip>
              {!current && (
                <Tooltip label={`Delete branch ${branch.name}`} placement="left">
                  <button className="git-mini-btn danger" onClick={() => handleDeleteBranch(branch)} disabled={busy} aria-label={`Delete branch ${branch.name}`}><TrashIcon size="xs" /></button>
                </Tooltip>
              )}
            </div>
          );
        })}
        {branches.some((b) => b.isRemote) && (
          <div className="git-sub-group-label">Remote</div>
        )}
        {branches.filter((b) => b.isRemote).map((branch) => (
          <div key={branch.name} className="git-branch-item remote">
            <Tooltip label={`Remote branch ${branch.remote}/${branch.name}`} placement="right">
              <span className="git-row-main" tabIndex={0} aria-label={`Remote branch ${branch.remote}/${branch.name}`}>
                <CircleIcon size="xs" className="branch-icon" />
                <span className="branch-name">{branch.name}</span>
              </span>
            </Tooltip>
          </div>
        ))}
      </GitSection>

      {dialog && createPortal(
              <GitDialog
                title={dialog.title}
                description={dialog.description}
                fields={dialog.fields}
                confirmLabel={dialog.confirmLabel}
                destructive={dialog.destructive}
                busy={busy}
                repoPath={repoPath}
                worktreeBaseDir={worktreeBaseDir}
                worktreeTemplate={worktreeTemplate}
                onSubmit={(values) => {
                  dialog.onSubmit(values);
                  setDialog(null);
                }}
                onCancel={() => setDialog(null)}
              />,
              document.body,
            )}
    </div>
  );

  function shell(text: string, hint?: string) {
    return (
      <div className="git-tree">
        <div className="git-header"><span className="section-title">Source Control</span></div>
        <div className="git-empty-state">
          <div className="git-empty">{text}</div>
          {hint && <div className="git-hint">{hint}</div>}
        </div>
      </div>
    );
  }
}

function GitSection({ title, count, expanded, onToggle, extra, children }: {
  title: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ExpandIcon = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="git-section">
      <div className="git-section-header">
        <button
          type="button"
          className="git-section-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <span className="git-section-title"><ExpandIcon size="sm" /> {title}</span>
          <span className="badge">{count}</span>
        </button>
        {extra}
      </div>
      {expanded && <div className="git-section-content">{children}</div>}
    </div>
  );
}

function buildFileTree(files: Array<{ path: string; working_dir: string; index: string; staged: boolean; unstaged: boolean }>, conflicted: string[]) {
  interface TreeNode {
    name: string;
    path: string;
    isDir: boolean;
    children: Map<string, TreeNode>;
    file?: { path: string; working_dir: string; index: string; staged: boolean; unstaged: boolean; conflicted: boolean };
  }
  const root: TreeNode = { name: '', path: '', isDir: true, children: new Map() };
  const conflictedPaths = new Set(conflicted);
  const filePaths = new Set(files.map((file) => file.path));
  const all = [
    ...files.map((file) => ({ ...file, conflicted: conflictedPaths.has(file.path) })),
    ...conflicted
      .filter((path) => !filePaths.has(path))
      .map((path) => ({ path, working_dir: 'U', index: 'U', staged: false, unstaged: false, conflicted: true })),
  ];
  for (const file of all) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: new Map(),
        });
      }
      node = node.children.get(part)!;
      if (isLast) {
        node.isDir = false;
        node.file = file;
      }
    }
  }
  return root;
}

function renderTreeNode(
  node: any,
  depth: number,
  busy: boolean,
  repoPath: string,
  onCopyTerminalPath?: (path: string) => Promise<void>,
  onOpenFile?: (resource: EditorResource) => void,
): React.ReactNode {
  const entries = Array.from(node.children.values()).sort((a: any, b: any) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries.map((child: any) => {
    if (child.isDir) {
      return (
        <GitTreeDir key={child.path} name={child.name} depth={depth}>
          {renderTreeNode(child, depth + 1, busy, repoPath, onCopyTerminalPath, onOpenFile)}
        </GitTreeDir>
      );
    }
    const f = child.file;
    const kind = f.conflicted ? 'conflicted' : f.staged && f.unstaged ? 'mixed' : f.staged ? 'staged' : 'unstaged';
    return (
      <GitFile
        key={child.path}
        repoPath={repoPath}
        path={child.file.path}
        kind={kind}
        wd={child.file.working_dir}
        index={child.file.index}
        depth={depth}
        onCopyTerminalPath={onCopyTerminalPath}
        onOpenFile={onOpenFile}
      />
    );
  });
}

function GitFileTree({ repoPath, files, conflicted, onCopyTerminalPath, onOpenFile }: {
  repoPath: string;
  files: Array<{ path: string; working_dir: string; index: string; staged: boolean; unstaged: boolean }>;
  conflicted: string[];
  onCopyTerminalPath?: (path: string) => Promise<void>;
  onOpenFile?: (resource: EditorResource) => void;
}) {
  const tree = buildFileTree(files, conflicted);
  return <>{renderTreeNode(tree, 0, false, repoPath, onCopyTerminalPath, onOpenFile)}</>;
}

function GitTreeDir({ name, depth, children }: { name: string; depth: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const ExpandIcon = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <>
      <button
        type="button"
        className="git-tree-dir"
        style={{ paddingLeft: 14 + depth * 14 }}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <ExpandIcon size="xs" />
        <FolderIcon size="xs" />
        <span>{name}</span>
      </button>
      {open && children}
    </>
  );
}

function GitFile({ repoPath, path, kind, wd, index, depth, onCopyTerminalPath, onOpenFile }: {
  repoPath: string;
  path: string;
  kind: 'staged' | 'unstaged' | 'mixed' | 'conflicted';
  wd?: string;
  index?: string;
  depth?: number;
  onCopyTerminalPath?: (path: string) => Promise<void>;
  onOpenFile?: (resource: EditorResource) => void;
}) {
  const isDeleted = wd === 'D' || index === 'D';
  const Icon = kind === 'conflicted' ? AlertIcon : kind === 'mixed' ? GitMergeIcon : isDeleted ? TrashIcon : wd === 'R' ? GitMergeIcon : GitCommitIcon;
  const FileIcon = kind === 'unstaged' && !isDeleted && wd !== 'R' ? fileIconFor(path, false) : Icon;
  const indent = depth !== undefined ? { paddingLeft: 14 + depth * 14 } : undefined;
  const absolutePath = resolveRepositoryPath(repoPath, path);
  const canOpen = !isDeleted;
  const title = kind === 'mixed'
    ? 'Staged and modified in working tree'
    : kind === 'conflicted'
      ? 'Merge conflict'
      : kind === 'staged'
        ? 'Staged change'
        : 'Working-tree change';
  return (
    <div className="git-file-row">
      <Tooltip label={canOpen
        ? `${path}: ${title} · Open in editor or drag into a terminal`
        : `${path}: Deleted from the working tree; there is no file to open`} placement="right">
        <button
          type="button"
          className={`git-file-item ${kind}`}
          style={indent}
          aria-label={canOpen ? `Open file ${path}: ${title}` : `${path}: Deleted from the working tree`}
          aria-disabled={!canOpen}
          onClick={() => {
            if (canOpen) onOpenFile?.({ kind: 'local', path: absolutePath });
          }}
          draggable
          onDragStart={(event) => {
            const started = beginTerminalPathDrag(event.dataTransfer, {
              version: 1,
              path: absolutePath,
              entryKind: 'file',
              origin: 'source-control',
              filesystem: { kind: 'local' },
            });
            if (!started) {
              endTerminalPathDrag();
              event.preventDefault();
            }
          }}
          onDragEnd={endTerminalPathDrag}
        >
          <FileIcon size="sm" className={`file-status-icon ${kind}`} />
          <span className="file-name">{path.split('/').pop()}</span>
        </button>
      </Tooltip>
      <TerminalPathCopyButton
        path={absolutePath}
        label={path}
        onCopyPath={onCopyTerminalPath}
      />
    </div>
  );
}

function GitDialog({ title, description, fields, confirmLabel, destructive, busy, repoPath, worktreeBaseDir, worktreeTemplate, onSubmit, onCancel }: {
  title: string;
  description?: string;
  fields: DialogField[];
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  repoPath?: string | null;
  worktreeBaseDir?: string;
  worktreeTemplate?: string;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) init[f.key] = f.defaultValue || '';
    return init;
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  useModalFocus({
    open: true,
    containerRef: dialogRef,
    onClose: onCancel,
    initialFocusSelector: destructive
      ? '[data-git-dialog-cancel]'
      : fields.length > 0
        ? '[data-git-dialog-field="0"]'
        : undefined,
  });

  // Auto-suggest worktree path when branch field changes
  useEffect(() => {
    if (!repoPath || !('path' in values) || !('branch' in values)) return;
    if (values.branch && !values.path) {
      const suggested = defaultWorktreePath(repoPath, values.branch, worktreeBaseDir, worktreeTemplate);
      setValues((prev) => ({ ...prev, path: suggested }));
    }
  }, [values.branch, values.path, repoPath, worktreeBaseDir, worktreeTemplate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <div className="git-dialog-overlay" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="git-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div id={titleId} className="git-dialog-title">{title}</div>
        <form onSubmit={handleSubmit}>
          {fields.map((f, index) => {
            const inputId = `${dialogId}-field-${index}`;
            return (
              <div key={f.key} className="git-dialog-field">
                <label className="git-dialog-label" htmlFor={inputId}>{f.label}</label>
                <input
                  id={inputId}
                  className="git-dialog-input"
                  type="text"
                  placeholder={f.placeholder}
                  value={values[f.key] || ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  data-git-dialog-field={index}
                />
              </div>
            );
          })}
          {description && <div id={descriptionId} className="git-dialog-hint">{description}</div>}
          <div className="git-dialog-actions">
            <button type="button" className="git-dialog-btn cancel" data-git-dialog-cancel onClick={onCancel}>Cancel</button>
            <button type="submit" className={`git-dialog-btn confirm ${destructive ? 'danger' : ''}`} disabled={busy}>{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
