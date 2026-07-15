import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  RefreshIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon,
  GitCommitIcon, SourceControlIcon as GitBranchIcon, GitMergeIcon,
  TrashIcon, AlertIcon, CircleDotIcon, CircleIcon, FolderIcon,
  fileIconFor,
  SettingsIconCmp, MoreIcon, ListIcon,
} from '../icons';
import { defaultWorktreePath, GitWorktreeInfo, basename } from '../../shared/gitWorktrees';
import { refreshCoordinator, useRefreshTask } from '../refreshCoordinator';
import { GitStatusResult } from '../useGitRepository';

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
  fields: DialogField[];
  confirmLabel: string;
  destructive?: boolean;
  onSubmit: (values: Record<string, string>) => void;
}

export default function GitTree({ cwdReady, isRemote, repoPath, status, searching, onOpenLocalTabAt }: GitTreeProps) {
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
      if (generation === detailsGeneration.current) setMessage('Failed to load git data');
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
      title: 'Create Branch',
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
        { key: 'force', label: 'Type FORCE to force delete (-D), leave blank for safe (-d)', placeholder: '' },
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
      title: 'Worktree Defaults',
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
      title: createBranch ? 'Add Worktree (New Branch)' : 'Add Worktree (Existing Branch)',
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
      confirmLabel: 'Remove',
      destructive: true,
      fields: [
        { key: 'force', label: 'Type FORCE to discard local changes, leave blank for normal', placeholder: '' },
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
      title: 'Prune Stale Worktrees',
      confirmLabel: 'Prune',
      destructive: true,
      fields: [],
      onSubmit: () => {
        runGitAction(() => window.janet.gitPruneWorktrees({ repoPath }), 'Pruned stale worktrees');
      },
    });
  };

  const toggle = (section: Section) => setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  if (searching) return shell('Searching for git repos…');
  if (isRemote) return shell('Git features are local-only for now', 'Open a local repo tab to manage branches/worktrees.');
  if (!repoPath) return shell('No git repo found', 'cd into a repo to see branch and worktree controls.');

  return (
    <div className="git-tree">
      <div className="git-header">
        <span className="section-title">Source Control</span>
        <button className="icon-btn" onClick={() => refreshCoordinator.invalidate('manual')} disabled={busy} title="Refresh" aria-label="Refresh">
          <RefreshIcon size="sm" />
        </button>
      </div>

      <div className="git-repo-path" title={repoPath}>
        <GitBranchIcon size="xs" /> {status?.current || 'HEAD'}
        {status && status.files.length > 0 && <span className="git-pill dirty">● {status.files.length}</span>}
        {status && status.ahead > 0 && <span className="git-pill ahead">↑{status.ahead}</span>}
        {status && status.behind > 0 && <span className="git-pill behind">↓{status.behind}</span>}
      </div>
      {message && <div className="git-message">{message}</div>}

      {status && (
        <GitSection title="Changes" count={status.files.length} expanded={expanded.changes} onToggle={() => toggle('changes')}
          extra={status.files.length > 0 && (
            <button className="git-view-toggle" onClick={(e) => { e.stopPropagation(); setChangesView(v => v === 'flat' ? 'tree' : 'flat'); }} title={changesView === 'flat' ? 'Switch to tree view' : 'Switch to flat list'}>
              {changesView === 'flat' ? <FolderIcon size="xs" /> : <ListIcon size="xs" />}
            </button>
          )}
        >
          {status.files.length === 0 && <div className="git-empty">Working tree clean</div>}
          {status.files.length > 0 && changesView === 'tree' ? (
            <GitFileTree files={status.files} conflicted={status.conflicted} />
          ) : (
            status.files.map((file) => (
              <GitFile
                key={file.path}
                path={file.path}
                kind={status.conflicted.includes(file.path)
                  ? 'conflicted'
                  : file.staged && file.unstaged
                    ? 'mixed'
                    : file.staged
                      ? 'staged'
                      : 'unstaged'}
                wd={file.working_dir}
              />
            ))
          )}
        </GitSection>
      )}

<GitSection title="Worktrees" count={worktrees.length} expanded={expanded.worktrees} onToggle={() => toggle('worktrees')}
        extra={
          <div className="git-kebab-menu">
            <button className="git-view-toggle" onClick={(e) => { e.stopPropagation(); setWorktreeMenuOpen(o => !o); }} title="More options"><MoreIcon size="xs" /></button>
            {worktreeMenuOpen && (
              <>
                <div className="git-kebab-overlay" onClick={() => setWorktreeMenuOpen(false)} />
                <div className="git-kebab-dropdown">
                  <button className="git-kebab-item" onClick={() => { setWorktreeMenuOpen(false); handleWorktreeSettings(); }} disabled={busy}>
                    <SettingsIconCmp size="xs" /> Worktree defaults
                  </button>
                  <button className="git-kebab-item danger" onClick={() => { setWorktreeMenuOpen(false); handlePruneWorktrees(); }} disabled={busy}>
                    <TrashIcon size="xs" /> Clean stale worktrees
                  </button>
                </div>
              </>
            )}
          </div>
        }
      >
        <div className="git-inline-actions">
          <button className="git-action-btn" onClick={() => handleAddWorktree(true)} disabled={busy}><PlusIcon size="xs" /> New branch</button>
          <button className="git-action-btn" onClick={() => handleAddWorktree(false)} disabled={busy}><PlusIcon size="xs" /> Existing</button>
        </div>
        {worktrees.map((tree) => (
          <div key={tree.path} className="git-worktree-item">
            <button className="git-row-main" onClick={() => onOpenLocalTabAt?.(tree.path, basename(tree.path))} title={tree.path}>
              <FolderIcon size="xs" />
              <span className="branch-name">{basename(tree.path)}</span>
              <span className="git-row-note">{tree.path === repoPath && status?.current ? status.current : tree.branch || 'detached'}</span>
            </button>
            {tree.path !== repoPath && <button className="git-mini-btn danger" onClick={() => handleRemoveWorktree(tree)} disabled={busy} title="Remove worktree"><TrashIcon size="xs" /></button>}
          </div>
        ))}
      </GitSection>

<GitSection title="Branches" count={branches.length} expanded={expanded.branches} onToggle={() => toggle('branches')}>
        <div className="git-inline-actions">
          <button className="git-action-btn" onClick={handleCreateBranch} disabled={busy}><PlusIcon size="xs" /> Branch</button>
        </div>
        {branches.filter((b) => !b.isRemote).map((branch) => {
          const current = status?.current ? branch.name === status.current : branch.current;
          const DotIcon = current ? CircleDotIcon : CircleIcon;
          return (
            <div key={branch.name} className={`git-branch-item ${current ? 'current' : ''}`}>
              <button className="git-row-main" onClick={() => !current && handleCheckout(branch.name)} disabled={busy || current}
                       title={current ? 'Current branch' : `Switch to ${branch.name}`}>
                <DotIcon size="xs" className="branch-icon" />
                <span className="branch-name">{branch.name}</span>
                {branch.worktreePath && <span className="git-row-note">worktree</span>}
              </button>
              {!current && <button className="git-mini-btn danger" onClick={() => handleDeleteBranch(branch)} disabled={busy} title="Delete branch"><TrashIcon size="xs" /></button>}
            </div>
          );
        })}
        {branches.some((b) => b.isRemote) && (
          <div className="git-sub-group-label">Remote</div>
        )}
        {branches.filter((b) => b.isRemote).map((branch) => (
          <div key={branch.name} className="git-branch-item remote">
            <button className="git-row-main" disabled title={`${branch.remote}/${branch.name}`}>
              <CircleIcon size="xs" className="branch-icon" />
              <span className="branch-name">{branch.name}</span>
            </button>
          </div>
        ))}
      </GitSection>

      {dialog && createPortal(
              <GitDialog
                title={dialog.title}
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
        <div className="git-empty">{text}</div>
        {hint && <div className="git-hint">{hint}</div>}
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

function renderTreeNode(node: any, depth: number, busy: boolean): React.ReactNode {
  const entries = Array.from(node.children.values()).sort((a: any, b: any) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries.map((child: any) => {
    if (child.isDir) {
      return (
        <GitTreeDir key={child.path} name={child.name} depth={depth}>
          {renderTreeNode(child, depth + 1, busy)}
        </GitTreeDir>
      );
    }
    const f = child.file;
    const kind = f.conflicted ? 'conflicted' : f.staged && f.unstaged ? 'mixed' : f.staged ? 'staged' : 'unstaged';
    return <GitFile key={child.path} path={child.file.path} kind={kind} wd={child.file.working_dir} depth={depth} />;
  });
}

function GitFileTree({ files, conflicted }: { files: Array<{ path: string; working_dir: string; index: string; staged: boolean; unstaged: boolean }>; conflicted: string[] }) {
  const tree = buildFileTree(files, conflicted);
  return <>{renderTreeNode(tree, 0, false)}</>;
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

function GitFile({ path, kind, wd, depth }: { path: string; kind: 'staged' | 'unstaged' | 'mixed' | 'conflicted'; wd?: string; depth?: number }) {
  const Icon = kind === 'conflicted' ? AlertIcon : kind === 'mixed' ? GitMergeIcon : wd === 'D' ? TrashIcon : wd === 'R' ? GitMergeIcon : GitCommitIcon;
  const FileIcon = kind === 'unstaged' && wd !== 'D' && wd !== 'R' ? fileIconFor(path, false) : Icon;
  const indent = depth !== undefined ? { paddingLeft: 14 + depth * 14 } : undefined;
  const title = kind === 'mixed'
    ? 'Staged and modified in working tree'
    : kind === 'conflicted'
      ? 'Merge conflict'
      : kind === 'staged'
        ? 'Staged change'
        : 'Working-tree change';
  return (
    <div className={`git-file-item ${kind}`} style={indent} title={title}>
      <FileIcon size="sm" className={`file-status-icon ${kind}`} />
      <span className="file-name">{path.split('/').pop()}</span>
    </div>
  );
}

function GitDialog({ title, fields, confirmLabel, destructive, busy, repoPath, worktreeBaseDir, worktreeTemplate, onSubmit, onCancel }: {
  title: string;
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
      <div className="git-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="git-dialog-title">{title}</div>
        <form onSubmit={handleSubmit}>
          {fields.map((f) => (
            <div key={f.key} className="git-dialog-field">
              <label className="git-dialog-label">{f.label}</label>
              <input
                className="git-dialog-input"
                type="text"
                placeholder={f.placeholder}
                value={values[f.key] || ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                autoFocus={f.key === fields[0]?.key}
              />
            </div>
          ))}
          {fields.length === 0 && <div className="git-dialog-hint">Are you sure?</div>}
          <div className="git-dialog-actions">
            <button type="button" className="git-dialog-btn cancel" onClick={onCancel}>Cancel</button>
            <button type="submit" className={`git-dialog-btn confirm ${destructive ? 'danger' : ''}`} disabled={busy}>{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
