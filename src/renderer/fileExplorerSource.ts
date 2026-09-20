export type FileExplorerSource =
  | {
      kind: 'local';
      key: string;
      cwd: string;
      ready: boolean;
    };
