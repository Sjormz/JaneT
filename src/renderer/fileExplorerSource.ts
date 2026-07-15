export type FileExplorerSource =
  | {
      kind: 'local';
      key: string;
      cwd: string;
      ready: boolean;
    }
  | {
      kind: 'ssh';
      key: string;
      sessionId: string;
      label: string;
      connectionState: 'connecting' | 'ready' | 'disconnected';
      ready: boolean;
    };
