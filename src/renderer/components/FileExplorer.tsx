import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeftIcon, EyeIcon, EyeOffIcon, RefreshIcon,
  fileIconFor,
} from '../icons';
import { refreshCoordinator, RefreshReason, useRefreshTask } from '../refreshCoordinator';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: string;
}

interface FileExplorerProps {
  /** Cwd of the focused terminal. The explorer reloads when this changes. */
  cwd: string;
  /** True once we have a real cwd (vs. the empty string initial state). */
  cwdReady: boolean;
  /** True if the active tab is an SSH tab. */
  isRemote: boolean;
}

export default function FileExplorer({ cwd, cwdReady, isRemote }: FileExplorerProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirContents, setDirContents] = useState<Record<string, FileEntry[]>>({});
  const requestGeneration = useRef(0);
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const loadDirectory = useCallback(async (dirPath: string, reason: RefreshReason = 'manual') => {
    const generation = ++requestGeneration.current;
    const foreground = reason === 'register' || reason === 'manual';
    if (foreground) setLoading(true);
    setError(null);
    try {
      const result = await window.janet.fsListDir({ dirPath, showHidden });
      if (generation !== requestGeneration.current || currentPathRef.current !== dirPath) return;
      setEntries((current) => fileEntriesEqual(current, result) ? current : result);
    } catch (err: any) {
      if (generation !== requestGeneration.current || currentPathRef.current !== dirPath) return;
      setError(err.message || 'Failed to list directory');
      if (foreground) setEntries([]);
    } finally {
      if (generation === requestGeneration.current && foreground) setLoading(false);
    }
  }, [showHidden]);

  // Sync the explorer's current path with the focused terminal's cwd.
  // We only auto-jump when the cwd prop changes (not when the user
  // navigates manually inside the explorer). This is the core "follow
  // the terminal" feature: any `cd` in the terminal moves the explorer.
  useEffect(() => {
    if (!cwd) return;
    setCurrentPath(cwd);
    setHistory([]); // terminal-driven navigation is a fresh start
  }, [cwd]);

  useEffect(() => {
    requestGeneration.current += 1;
  }, [currentPath, showHidden]);

  const refreshKey = `files:${currentPath}:${showHidden ? 'hidden' : 'visible'}`;
  useRefreshTask({
    key: refreshKey,
    intervalMs: 5_000,
    enabled: cwdReady && Boolean(currentPath),
    run: (reason) => currentPath ? loadDirectory(currentPath, reason) : undefined,
  });

  const navigateTo = (dirPath: string) => {
    setHistory((prev) => [...prev, currentPath]);
    setCurrentPath(dirPath);
  };

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory((h) => h.slice(0, -1));
      setCurrentPath(prev);
    }
  };

  const handleFileClick = (entry: FileEntry) => {
    if (entry.isDirectory) navigateTo(entry.path);
  };

  const pathSegments = currentPath.split(/[/\\]/).filter(Boolean);

  return (
    <div className="file-explorer">
      {isRemote && (
        <div className="explorer-remote-notice">
          The active tab is an SSH session. The file explorer shows your
          <em> local </em>
          cwd; the remote cwd is shown in the status bar.
        </div>
      )}
      <div className="explorer-header">
        <span className="section-title">Explorer</span>
        <div className="explorer-toolbar">
          <button
            className="icon-btn"
            onClick={goBack}
            disabled={history.length === 0}
            title="Go back"
            aria-label="Go back"
          >
            <ArrowLeftIcon size="sm" />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowHidden(!showHidden)}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
            aria-label="Toggle hidden files"
            aria-pressed={showHidden}
          >
            {showHidden ? <EyeOffIcon size="sm" /> : <EyeIcon size="sm" />}
          </button>
          <button
            className="icon-btn"
            onClick={() => refreshCoordinator.invalidate('manual', refreshKey)}
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshIcon size="sm" />
          </button>
        </div>
      </div>

      <div className="explorer-breadcrumb">
        {currentPath.startsWith('/') && (
          <button className="crumb" onClick={() => navigateTo('/')}>/</button>
        )}
        {currentPath.match(/^[A-Z]:/) && (
          <button
            className="crumb drive-crumb"
            onClick={() => {
              const driveRoot = currentPath.substring(0, 3);
              navigateTo(driveRoot);
            }}
          >
            {currentPath.substring(0, 2)}
          </button>
        )}
        {pathSegments.map((seg, i) => {
          const pathSoFar = currentPath.startsWith('/')
            ? `/${pathSegments.slice(0, i + 1).join('/')}`
            : pathSegments.slice(0, i + 1).join(currentPath.includes('\\') ? '\\' : '/');
          const isDrive = seg.match(/^[A-Z]:$/i) || seg.match(/^[A-Z]$/i);
          if (isDrive && i === 0) return null;
          return (
            <React.Fragment key={pathSoFar}>
              <span className="crumb-sep">/</span>
              <button className="crumb" onClick={() => navigateTo(pathSoFar)}>
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="explorer-tree">
        {loading && <div className="explorer-loading">Loading…</div>}
        {error && <div className="explorer-error">{error}</div>}

        {entries.map((entry) => {
          const Icon = fileIconFor(entry.name, entry.isDirectory, expandedDirs.has(entry.path));
          return (
            <div
              key={entry.path}
              className={`explorer-item ${entry.isDirectory ? 'dir' : 'file'}`}
              onClick={() => handleFileClick(entry)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', entry.path);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Icon size="md" className="item-icon" />
              <span className="item-name">{entry.name}</span>
            </div>
          );
        })}

        {!loading && entries.length === 0 && !error && (
          <div className="explorer-empty">Empty directory</div>
        )}
      </div>
    </div>
  );
}

function fileEntriesEqual(left: FileEntry[], right: FileEntry[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const candidate = right[index];
    return candidate !== undefined &&
      entry.path === candidate.path &&
      entry.isDirectory === candidate.isDirectory &&
      entry.isSymlink === candidate.isSymlink &&
      entry.size === candidate.size &&
      entry.mtime === candidate.mtime;
  });
}
