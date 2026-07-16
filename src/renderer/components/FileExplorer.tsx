import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeftIcon, EyeIcon, EyeOffIcon, RefreshIcon,
  fileIconFor,
} from '../icons';
import type { FileEntry } from '../../shared/files';
import type { FileExplorerSource } from '../fileExplorerSource';
import { refreshCoordinator, RefreshReason, useRefreshTask } from '../refreshCoordinator';
import { beginTerminalPathDrag, endTerminalPathDrag } from '../terminalPathDrag';
import TerminalPathCopyButton from './TerminalPathCopyButton';
import Tooltip from './Tooltip';
import type { EditorResource } from '../editorDocuments';

interface NavigationState {
  currentPath: string;
  history: string[];
}

interface FileExplorerProps {
  source: FileExplorerSource;
  onCopyTerminalPath?: (path: string) => Promise<void>;
  onOpenFile?: (resource: EditorResource) => void;
}

interface LoadedDirectory {
  sourceKey: string;
  path: string;
  showHidden: boolean;
}

interface DirectorySnapshot extends LoadedDirectory {
  entries: FileEntry[];
  connectionId?: string;
}

interface DirectoryError {
  sourceKey: string;
  path: string;
  message: string;
}

interface DirectoryRequest {
  sourceKey: string;
  path: string;
}

export default function FileExplorer({ source, onCopyTerminalPath, onOpenFile }: FileExplorerProps) {
  const [navigationBySource, setNavigationBySource] = useState<Record<string, NavigationState>>(() => ({
    [source.key]: defaultNavigation(source),
  }));
  const [snapshot, setSnapshot] = useState<DirectorySnapshot | null>(null);
  const [foregroundRequest, setForegroundRequest] = useState<DirectoryRequest | null>(null);
  const [directoryError, setDirectoryError] = useState<DirectoryError | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const requestGeneration = useRef(0);
  const lastLoaded = useRef<LoadedDirectory | null>(null);

  const navigation = navigationBySource[source.key] ?? defaultNavigation(source);
  const currentPath = navigation.currentPath;
  const history = navigation.history;
  const currentPathRef = useRef(currentPath);
  const sourceKeyRef = useRef(source.key);
  currentPathRef.current = currentPath;
  sourceKeyRef.current = source.key;

  const localCwd = source.kind === 'local' ? source.cwd : '';
  useEffect(() => {
    if (source.kind !== 'local' || !source.cwd) return;
    setNavigationBySource((current) => {
      const previous = current[source.key];
      if (previous?.currentPath === source.cwd) return current;
      return {
        ...current,
        [source.key]: { currentPath: source.cwd, history: [] },
      };
    });
  }, [localCwd, source.key, source.kind]);

  // Never leave entries, status, or pending results visible across filesystems
  // or across a disconnect/reconnect boundary for the same SSH source.
  useEffect(() => {
    requestGeneration.current += 1;
    lastLoaded.current = null;
    setForegroundRequest(null);
    setDirectoryError(null);
  }, [source.key, source.ready]);

  const loadDirectory = useCallback(async (
    dirPath: string,
    reason: RefreshReason = 'manual',
  ) => {
    if (!source.ready) return;
    if (source.kind === 'local' && !dirPath) return;

    const prior = lastLoaded.current;
    if (
      reason === 'register' && prior?.sourceKey === source.key &&
      prior.path === dirPath && prior.showHidden === showHidden
    ) {
      return;
    }

    const generation = ++requestGeneration.current;
    const sourceKey = source.key;
    const requestedPath = dirPath;
    const foreground = reason === 'register' || reason === 'manual';
    if (foreground) setForegroundRequest({ sourceKey, path: requestedPath });
    setDirectoryError(null);

    try {
      let result: FileEntry[];
      let resolvedPath = requestedPath;
      let connectionId: string | undefined;
      if (source.kind === 'ssh') {
        const listing = await window.janet.sshListDir({
          sessionId: source.sessionId,
          ...(requestedPath ? { remotePath: requestedPath } : {}),
          showHidden,
        });
        result = listing.entries;
        resolvedPath = listing.resolvedPath;
        connectionId = listing.connectionId;
      } else {
        result = await window.janet.fsListDir({ dirPath: requestedPath, showHidden });
      }

      if (
        generation !== requestGeneration.current ||
        sourceKeyRef.current !== sourceKey ||
        currentPathRef.current !== requestedPath
      ) {
        return;
      }

      lastLoaded.current = { sourceKey, path: resolvedPath, showHidden };
      if (source.kind === 'ssh' && resolvedPath !== requestedPath) {
        setNavigationBySource((current) => {
          const previous = current[sourceKey] ?? { currentPath: requestedPath, history: [] };
          if (previous.currentPath !== requestedPath) return current;
          return {
            ...current,
            [sourceKey]: { ...previous, currentPath: resolvedPath },
          };
        });
      }
      setSnapshot((current) => {
        if (
          current?.sourceKey === sourceKey && current.path === resolvedPath &&
          current.showHidden === showHidden && current.connectionId === connectionId &&
          fileEntriesEqual(current.entries, result)
        ) {
          return current;
        }
        return { sourceKey, path: resolvedPath, showHidden, entries: result, connectionId };
      });
    } catch (loadError) {
      if (
        generation !== requestGeneration.current ||
        sourceKeyRef.current !== sourceKey ||
        currentPathRef.current !== requestedPath
      ) {
        return;
      }
      const message = loadError instanceof Error ? loadError.message : 'Failed to list directory';
      setDirectoryError({
        sourceKey,
        path: requestedPath,
        message: message || 'Failed to list directory',
      });
    } finally {
      if (
        generation === requestGeneration.current &&
        sourceKeyRef.current === sourceKey &&
        currentPathRef.current === requestedPath &&
        foreground
      ) {
        setForegroundRequest((current) => (
          current?.sourceKey === sourceKey && current.path === requestedPath ? null : current
        ));
      }
    }
  }, [showHidden, source]);

  const refreshKey = `files:${source.key}:${currentPath || '@home'}:${showHidden ? 'hidden' : 'visible'}`;
  useRefreshTask({
    key: refreshKey,
    intervalMs: 5_000,
    enabled: source.ready && (source.kind === 'ssh' || Boolean(currentPath)),
    run: (reason) => loadDirectory(currentPath, reason),
  });

  const navigateTo = (dirPath: string) => {
    setNavigationBySource((current) => {
      const previous = current[source.key] ?? defaultNavigation(source);
      if (previous.currentPath === dirPath) return current;
      return {
        ...current,
        [source.key]: {
          currentPath: dirPath,
          history: previous.currentPath
            ? [...previous.history, previous.currentPath]
            : previous.history,
        },
      };
    });
  };

  const goBack = () => {
    setNavigationBySource((current) => {
      const previous = current[source.key] ?? defaultNavigation(source);
      if (previous.history.length === 0) return current;
      return {
        ...current,
        [source.key]: {
          currentPath: previous.history[previous.history.length - 1],
          history: previous.history.slice(0, -1),
        },
      };
    });
  };

  const pathSegments = currentPath.split(source.kind === 'ssh' ? '/' : /[/\\]/).filter(Boolean);
  const ready = source.ready && (source.kind === 'ssh' || Boolean(currentPath));
  const snapshotMatches = Boolean(
    ready && snapshot?.sourceKey === source.key && snapshot.path === currentPath &&
    snapshot.showHidden === showHidden,
  );
  const error = ready && directoryError?.sourceKey === source.key && directoryError.path === currentPath
    ? directoryError.message
    : null;
  const entries = snapshotMatches ? snapshot!.entries : [];
  const loading = ready && !error && (
    !snapshotMatches || (
      foregroundRequest?.sourceKey === source.key && foregroundRequest.path === currentPath
    )
  );

  return (
    <div className="file-explorer">
      <div className="explorer-header">
        <span className="section-title">Explorer</span>
        <div className="explorer-toolbar">
          <Tooltip label="Back to previous folder" placement="bottom">
            <button className="icon-btn" onClick={goBack} disabled={history.length === 0} aria-label="Back to previous folder">
              <ArrowLeftIcon size="sm" />
            </button>
          </Tooltip>
          <Tooltip label={showHidden ? 'Hide hidden files' : 'Show hidden files'} placement="bottom">
            <button
              className="icon-btn"
              onClick={() => setShowHidden(!showHidden)}
              aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
              aria-pressed={showHidden}
              disabled={!source.ready}
            >
              {showHidden ? <EyeOffIcon size="sm" /> : <EyeIcon size="sm" />}
            </button>
          </Tooltip>
          <Tooltip label="Refresh files" placement="bottom">
            <button className="icon-btn" onClick={() => refreshCoordinator.invalidate('manual', refreshKey)} aria-label="Refresh files" disabled={!source.ready}>
              <RefreshIcon size="sm" />
            </button>
          </Tooltip>
        </div>
      </div>

      {source.kind === 'ssh' && (
        <div className="explorer-remote-notice" role="status">
          Files on <strong>{source.label}</strong>
        </div>
      )}

      <div className="explorer-breadcrumb">
        {currentPath.startsWith('/') && (
          <button className="crumb" onClick={() => navigateTo('/')} aria-label="Open filesystem root">/</button>
        )}
        {source.kind === 'local' && currentPath.match(/^[A-Z]:/) && (
          <button
            className="crumb drive-crumb"
            onClick={() => navigateTo(currentPath.substring(0, 3))}
          >
            {currentPath.substring(0, 2)}
          </button>
        )}
        {pathSegments.map((segment, index) => {
          const pathSoFar = currentPath.startsWith('/')
            ? `/${pathSegments.slice(0, index + 1).join('/')}`
            : pathSegments.slice(0, index + 1).join(
              source.kind === 'local' && currentPath.includes('\\') ? '\\' : '/',
            );
          const isDrive = /^[A-Z]:?$/i.test(segment);
          if (source.kind === 'local' && isDrive && index === 0) return null;
          return (
            <React.Fragment key={pathSoFar}>
              {(!currentPath.startsWith('/') || index > 0) && <span className="crumb-sep">/</span>}
              <button className="crumb" onClick={() => navigateTo(pathSoFar)}>
                {segment}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className="explorer-tree" aria-busy={loading}>
        {!source.ready && source.kind === 'local' && (
          <div className="explorer-loading" role="status">Starting terminal…</div>
        )}
        {!source.ready && source.kind === 'ssh' && (
          <div className="explorer-loading" role="status">
            {source.connectionState === 'disconnected'
              ? `Reconnect ${source.label} to browse its files.`
              : `Connecting to files on ${source.label}…`}
          </div>
        )}
        {loading && <div className="explorer-loading" role="status">Loading…</div>}
        {error && (
          <div className="explorer-error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="explorer-retry"
              onClick={() => refreshCoordinator.invalidate('manual', refreshKey)}
            >
              Retry
            </button>
          </div>
        )}

        {entries.map((entry) => {
          const Icon = fileIconFor(entry.name, entry.isDirectory, false);
          const content = (
            <>
              <Icon size="md" className="item-icon" />
              <span className="item-name">{entry.name}</span>
            </>
          );
          const dragProps = {
            draggable: true,
            onDragStart: (event: React.DragEvent<HTMLElement>) => {
              const started = beginTerminalPathDrag(event.dataTransfer, {
                version: 1,
                path: entry.path,
                entryKind: entry.isDirectory ? 'directory' : 'file',
                origin: 'explorer',
                filesystem: source.kind === 'ssh'
                  ? { kind: 'ssh', sessionId: source.sessionId }
                  : { kind: 'local' },
              });
              if (!started) {
                endTerminalPathDrag();
                event.preventDefault();
              }
            },
            onDragEnd: endTerminalPathDrag,
          };

          if (entry.isDirectory) {
            return (
              <div key={entry.path} className="explorer-item-row">
                <Tooltip label={`${entry.name} · Drag into a terminal to paste its path`} placement="right">
                  <button
                    type="button"
                    className="explorer-item dir"
                    onClick={() => navigateTo(entry.path)}
                    aria-label={`Open folder ${entry.name}`}
                    {...dragProps}
                  >
                    {content}
                  </button>
                </Tooltip>
                <TerminalPathCopyButton
                  path={entry.path}
                  label={entry.name}
                  onCopyPath={onCopyTerminalPath}
                />
              </div>
            );
          }

          return (
            <div key={entry.path} className="explorer-item-row">
              <Tooltip label={`${entry.name} · Open in editor or drag into a terminal`} placement="right">
                <button
                  type="button"
                  className="explorer-item file"
                  aria-label={`Open file ${entry.name}`}
                  onClick={() => {
                    if (!onOpenFile) return;
                    if (source.kind === 'ssh') {
                      if (!snapshot?.connectionId) return;
                      onOpenFile({
                        kind: 'ssh',
                        sessionId: source.sessionId,
                        connectionId: snapshot.connectionId,
                        path: entry.path,
                        label: source.label,
                      });
                    } else {
                      onOpenFile({ kind: 'local', path: entry.path });
                    }
                  }}
                  {...dragProps}
                >
                  {content}
                </button>
              </Tooltip>
              <TerminalPathCopyButton
                path={entry.path}
                label={entry.name}
                onCopyPath={onCopyTerminalPath}
              />
            </div>
          );
        })}

        {ready && !loading && entries.length === 0 && !error && currentPath && (
          <div className="explorer-empty" role="status">This folder is empty</div>
        )}
      </div>
    </div>
  );
}

function defaultNavigation(source: FileExplorerSource): NavigationState {
  return {
    currentPath: source.kind === 'local' ? source.cwd : '',
    history: [],
  };
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
      entry.mode === candidate.mode &&
      entry.mtime === candidate.mtime;
  });
}
