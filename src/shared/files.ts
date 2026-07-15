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
  resolvedPath: string;
  entries: FileEntry[];
}

export interface SSHConnectionClosedEvent {
  id: string;
  reason: string;
}
