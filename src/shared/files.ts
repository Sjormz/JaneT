export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: string;
  mode: number;
}

export interface SSHListDirParams {
  sessionId: string;
  remotePath?: string;
  showHidden?: boolean;
}

export interface SSHDirectoryListing {
  /** Opaque identity for the ready SSH transport that produced this listing. */
  connectionId: string;
  resolvedPath: string;
  entries: FileEntry[];
}

export interface SSHConnectionClosedEvent {
  id: string;
  reason: string;
}
