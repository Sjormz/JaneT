import { Client, ClientChannel } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import * as os from 'os';
import { createHash } from 'crypto';
import { StringDecoder } from 'string_decoder';
import type {
  FileEntry,
  SSHConnectionClosedEvent,
  SSHDirectoryListing,
} from '../shared/files';

// Host verification may pause on a native Trust/Cancel dialog while the user
// checks the fingerprint out of band. Keep the handshake bounded, but do not
// apply the old 10-second machine-to-machine timeout to an interactive step.
const INTERACTIVE_READY_TIMEOUT_MS = 5 * 60 * 1000;
const SFTP_OPERATION_TIMEOUT_MS = 30_000;
const MAX_REMOTE_PATH_LENGTH = 8_192;

export interface SSHHostKeyStore {
  lookup(host: string, port: number): string | undefined;
  remember(host: string, port: number, fingerprint: string): void;
  /** Atomically replaces a matching legacy fingerprint. */
  migrate?(host: string, port: number, expectedFingerprint: string, fingerprint: string): void;
}

export type SSHHostKeyConfirmer = (
  host: string,
  port: number,
  fingerprint: string,
) => boolean | Promise<boolean>;

export type SSHConnectionClosedHandler = (event: SSHConnectionClosedEvent) => void;

interface SSHConnection {
  client: Client;
  id: string;
  config: {
    host: string;
    port: number;
    username?: string;
  };
  shells: Map<string, ClientChannel>;
  sftpOperations: Set<(error: Error) => void>;
  pendingWrites: Map<string, Array<string | Buffer>>;
  /** Handles already returned by createShell(), keyed by termId — lets a
   * repeat call (e.g. React 18 StrictMode's double mount-effect invoke)
   * reuse the in-flight/live shell instead of opening a second SSH
   * channel for the same termId. */
  shellHandles: Map<string, SSHShellHandle>;
}

interface PendingSSHConnection {
  client: Client;
  promise: Promise<void>;
  reject: (error: Error) => void;
  endpoint: string;
}

interface SSHShellHandle {
  /** Registers the single onData forwarder for this shell. Idempotent:
   * calling this more than once (e.g. StrictMode's double mount-effect
   * invoke re-running the IPC handler before the first call settles)
   * replaces rather than adds a listener, so PTY-side output is never
   * dispatched to two callbacks at once. */
  onData: (cb: (data: string) => void) => void;
  ready: Promise<void>;
  cancel: (error: Error) => void;
}

export class SSHManager {
  private connections: Map<string, SSHConnection> = new Map();
  private pendingConnections: Map<string, PendingSSHConnection> = new Map();
  private readonly inMemoryHostKeys = new Map<string, string>();

  constructor(
    private readonly hostKeyStore?: SSHHostKeyStore,
    private readonly confirmHostKey: SSHHostKeyConfirmer = () => false,
    private readonly onConnectionClosed?: SSHConnectionClosedHandler,
  ) {}

  connect(id: string, config: {
    host: string;
    port: number;
    username?: string;
    auth: string;
    password?: string;
    privateKey?: string;
  }): Promise<void> {
    const host = config.host.trim();
    const port = normalizePort(config.port);
    const endpoint = hostKeyId(host, port);
    const activeConnection = this.connections.get(id);
    if (activeConnection) {
      return hostKeyId(activeConnection.config.host, activeConnection.config.port) === endpoint
        ? Promise.resolve()
        : Promise.reject(new Error(`SSH session ${id} is already connected to another host`));
    }
    const existingAttempt = this.pendingConnections.get(id);
    if (existingAttempt) {
      return existingAttempt.endpoint === endpoint
        ? existingAttempt.promise
        : Promise.reject(new Error(`SSH session ${id} is already connecting to another host`));
    }

    const client = new Client();
    let resolveConnection: (() => void) | null = null;
    let rejectConnection: ((error: Error) => void) | null = null;
    let settled = false;
    let verificationError: Error | null = null;

    const promise = new Promise<void>((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
    });
    const rejectPending = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectConnection?.(error);
    };
    this.pendingConnections.set(id, { client, promise, reject: rejectPending, endpoint });
    const isCurrentPendingAttempt = () => (
      !settled && this.pendingConnections.get(id)?.client === client
    );

    const removeConnection = (reason: Error): boolean => {
      const pending = this.pendingConnections.get(id);
      if (pending?.client === client) this.pendingConnections.delete(id);
      const connection = this.connections.get(id);
      if (connection?.client === client) {
        connection.pendingWrites.clear();
        for (const cancel of connection.sftpOperations) cancel(reason);
        connection.sftpOperations.clear();
        for (const handle of connection.shellHandles.values()) handle.cancel(reason);
        connection.shellHandles.clear();
        for (const shell of connection.shells.values()) {
          try { shell.close(); } catch {}
        }
        connection.shells.clear();
        this.connections.delete(id);
        return true;
      }
      return false;
    };
    const notifyUnexpectedClose = (reason: Error) => {
      try {
        this.onConnectionClosed?.({ id, reason: reason.message });
      } catch {
        // A lifecycle observer must not interrupt SSH resource cleanup.
      }
    };

    client.on('ready', () => {
      const pending = this.pendingConnections.get(id);
      if (pending?.client !== client) {
        client.end();
        return;
      }

      this.pendingConnections.delete(id);
      this.connections.set(id, {
          client,
          id,
          config: { host, port, username: config.username },
          shells: new Map(),
          sftpOperations: new Set(),
          pendingWrites: new Map(),
          shellHandles: new Map(),
      });
      settled = true;
      resolveConnection?.();
    });

    client.on('error', (error) => {
      if (removeConnection(error)) notifyUnexpectedClose(error);
      rejectPending(verificationError ?? error);
    });
    const handleConnectionClosed = () => {
      const wasPending = this.pendingConnections.get(id)?.client === client;
      const error = verificationError ?? new Error(wasPending
        ? `SSH connection to ${host}:${port} closed before it was ready`
        : `SSH connection to ${host}:${port} closed unexpectedly`);
      if (removeConnection(error)) notifyUnexpectedClose(error);
      if (wasPending) rejectPending(error);
    };
    client.on('end', handleConnectionClosed);
    client.on('close', handleConnectionClosed);

    const connectConfig: any = {
      host,
      port,
      username: normalizeUsername(config.username),
      readyTimeout: INTERACTIVE_READY_TIMEOUT_MS,
      tryKeyboard: true,
      hostVerifier: (hostKey: Buffer, decision: (accepted: boolean) => void) => {
        try {
          if (!isCurrentPendingAttempt()) return;
          const { fingerprint, legacyFingerprint } = hostKeyFingerprints(hostKey);
          const trusted = this.lookupHostKey(host, port);
          if (trusted === legacyFingerprint) {
            try {
              this.migrateHostKey(host, port, legacyFingerprint, fingerprint);
              decision(true);
            } catch (error) {
              verificationError = error instanceof Error
                ? error
                : new Error(`Could not migrate SSH host key for ${host}:${port}`);
              decision(false);
            }
            return;
          }
          if (trusted && trusted !== fingerprint) {
            verificationError = new Error(`SSH host key changed for ${host}:${port}`);
            decision(false);
            return;
          }
          if (trusted) {
            decision(true);
            return;
          }

          void Promise.resolve(this.confirmHostKey(host, port, fingerprint)).then((approved) => {
            // A native confirmation can outlive the underlying handshake. A
            // late approval must never trust a key for a timed-out/cancelled
            // attempt, nor for a newer attempt that reused the same session id.
            if (!isCurrentPendingAttempt()) return;
            if (!approved) {
              verificationError = new Error(`SSH host key was not trusted for ${host}:${port}`);
              decision(false);
              return;
            }
            try {
              this.rememberHostKey(host, port, fingerprint);
              decision(true);
            } catch (error) {
              verificationError = error instanceof Error
                ? error
                : new Error(`Could not remember SSH host key for ${host}:${port}`);
              decision(false);
            }
          }, (error) => {
            if (!isCurrentPendingAttempt()) return;
            verificationError = error instanceof Error
              ? error
              : new Error(`Could not confirm SSH host key for ${host}:${port}`);
            decision(false);
          });
        } catch (error) {
          if (!isCurrentPendingAttempt()) return;
          verificationError = error instanceof Error
            ? error
            : new Error(`Could not verify SSH host key for ${host}:${port}`);
          decision(false);
        }
      },
    };

    client.on('keyboard-interactive', (_name, _instructions, _instructionsLang, prompts, finish) => {
      const answer = config.password ?? '';
      finish(prompts.map(() => answer));
    });

    if (config.auth === 'password' && config.password) {
      connectConfig.password = config.password;
    } else if (config.auth === 'key' && config.privateKey) {
      connectConfig.privateKey = config.privateKey;
    }

    try {
      client.connect(connectConfig);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      removeConnection(failure);
      rejectPending(failure);
    }
    return promise;
  }

  createShell(sessionId: string, termId: string, size: { cols: number; rows: number }): SSHShellHandle {
    const conn = this.connections.get(sessionId);
    if (!conn) throw new Error(`SSH session ${sessionId} not found`);

    // Idempotent by termId — see the `shellHandles` doc comment on
    // SSHConnection. Without this a repeat createShell() call (StrictMode
    // double mount, or a stray re-invocation) would open a second SSH
    // channel and dispatch to a second set of callbacks, doubling any
    // output that lands before the caller notices and discards the first
    // handle — the same class of bug as the local-pty duplicate-prompt
    // issue, just over an SSH channel instead of a local pty.
    const existingHandle = conn.shellHandles.get(termId);
    if (existingHandle) return existingHandle;

    let activeCallback: ((data: string) => void) | null = null;
    const pendingChunks: string[] = [];
    let resolveReady: (() => void) | null = null;
    let rejectReady: ((err: Error) => void) | null = null;
    let readySettled = false;

    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const dispatch = (str: string) => {
      if (!str) return;
      if (!activeCallback) {
        pendingChunks.push(str);
        return;
      }

      activeCallback(str);
    };

    const handle: SSHShellHandle = {
      onData: (cb: (data: string) => void) => {
        activeCallback = cb;
        if (pendingChunks.length > 0) {
          for (const chunk of pendingChunks) {
            cb(chunk);
          }
          pendingChunks.length = 0;
        }
      },
      ready,
      cancel: (error: Error) => {
        if (readySettled) return;
        readySettled = true;
        rejectReady?.(error);
      },
    };
    conn.shellHandles.set(termId, handle);

    conn.client.shell({
      cols: size.cols,
      rows: size.rows,
      term: 'xterm-256color',
    }, (err, stream) => {
      if (this.connections.get(sessionId) !== conn || conn.shellHandles.get(termId) !== handle) {
        try { stream?.close(); } catch {}
        handle.cancel(new Error(`SSH shell ${termId} was closed before it was ready`));
        return;
      }
      if (err || !stream) {
        conn.pendingWrites.delete(termId);
        conn.shellHandles.delete(termId);
        handle.cancel(err || new Error('Failed to create SSH shell'));
        return;
      }

      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      let decodersEnded = false;
      stream.on('data', (data: Buffer) => {
        dispatch(stdoutDecoder.write(data));
      });

      if (stream.stderr) {
        stream.stderr.on('data', (data: Buffer) => {
          dispatch(stderrDecoder.write(data));
        });
      }

      stream.on('close', () => {
        if (!decodersEnded) {
          decodersEnded = true;
          dispatch(stdoutDecoder.end());
          dispatch(stderrDecoder.end());
        }
        const ownsShell = conn.shells.get(termId) === stream;
        const ownsHandle = conn.shellHandles.get(termId) === handle;
        if (ownsShell) conn.shells.delete(termId);
        if (ownsShell || ownsHandle) conn.pendingWrites.delete(termId);
        if (ownsHandle) conn.shellHandles.delete(termId);
      });

      conn.shells.set(termId, stream);

      const queuedWrites = conn.pendingWrites.get(termId);
      if (queuedWrites && queuedWrites.length > 0) {
        for (const chunk of queuedWrites) {
          stream.write(chunk);
        }
        conn.pendingWrites.delete(termId);
      }

      readySettled = true;
      resolveReady?.();
    });
    return handle;
  }

  private terminalConnection(termId: string, sessionId?: string): SSHConnection | undefined {
    if (sessionId) {
      const conn = this.connections.get(sessionId);
      return conn && (conn.shells.has(termId) || conn.shellHandles.has(termId)) ? conn : undefined;
    }
    return Array.from(this.connections.values()).find(
      (conn) => conn.shells.has(termId) || conn.shellHandles.has(termId),
    );
  }

  private writeShellChunk(termId: string, data: string | Buffer, sessionId?: string): void {
    const conn = this.terminalConnection(termId, sessionId);
    if (!conn) return;
    const shell = conn.shells.get(termId);
    if (shell) {
      shell.write(data);
      return;
    }
    const queued = conn.pendingWrites.get(termId) || [];
    queued.push(data);
    conn.pendingWrites.set(termId, queued);
  }

  writeShell(termId: string, data: string, sessionId?: string): void {
    this.writeShellChunk(termId, data, sessionId);
  }

  writeShellBinary(termId: string, data: string, sessionId?: string): void {
    this.writeShellChunk(termId, Buffer.from(data, 'binary'), sessionId);
  }

  destroyShell(termId: string, sessionId?: string): boolean {
    const conn = this.terminalConnection(termId, sessionId);
    if (!conn) return false;

    const handle = conn.shellHandles.get(termId);
    const shell = conn.shells.get(termId);
    if (!handle && !shell && !conn.pendingWrites.has(termId)) return false;

    conn.pendingWrites.delete(termId);
    conn.shellHandles.delete(termId);
    conn.shells.delete(termId);
    handle?.cancel(new Error(`SSH shell ${termId} was closed`));
    try { shell?.close(); } catch {}
    return true;
  }

  resizeShell(termId: string, cols: number, rows: number): void {
    this.connections.forEach((conn) => {
      const shell = conn.shells.get(termId);
      if (shell) {
        shell.setWindow(rows, cols, 0, 0);
        return;
      }
    });
  }

  async listDir(
    sessionId: string,
    remotePath?: string,
    showHidden: boolean = false,
  ): Promise<SSHDirectoryListing> {
    const requestedPath = validateRemotePath(remotePath);
    const includeHidden = showHidden === true;

    return this.withSftp(sessionId, (sftp, done, isSettled) => {
      sftp.realpath(requestedPath, (realpathError, resolvedPath) => {
        if (isSettled()) return;
        if (realpathError) {
          done(realpathError);
          return;
        }
        try {
          if (!resolvedPath) {
            done(new Error(`SFTP server returned an empty path for ${requestedPath}`));
            return;
          }
          const canonicalPath = validateRemotePath(resolvedPath);

          sftp.readdir(canonicalPath, (readError, list) => {
            if (isSettled()) return;
            if (readError) {
              done(readError);
              return;
            }

            try {
              const entries = list
                .filter((item) => isSafeRemoteEntryName(item.filename))
                .filter((item) => includeHidden || !item.filename.startsWith('.'))
                .map((item): FileEntry => ({
                  name: item.filename,
                  path: joinRemotePath(canonicalPath, item.filename),
                  isDirectory: item.attrs.isDirectory(),
                  isSymlink: item.attrs.isSymbolicLink(),
                  size: finiteNumber(item.attrs.size),
                  mode: finiteNumber(item.attrs.mode),
                  mtime: isoTimestamp(item.attrs.mtime),
                }));

              // readdir() returns lstat-style attributes, so a symlink to a
              // directory normally looks like a non-directory. Resolve only
              // symlink targets, one at a time, so those links remain
              // navigable without flooding the server with stat requests.
              const resolveNextSymlink = (index: number) => {
                if (isSettled()) return;
                while (index < entries.length && !entries[index].isSymlink) index += 1;
                if (index >= entries.length) {
                  sortFileEntries(entries);
                  done(undefined, { resolvedPath: canonicalPath, entries });
                  return;
                }

                const entry = entries[index];
                let statSettled = false;
                const continueAfterStat = () => {
                  if (statSettled) return;
                  statSettled = true;
                  // Protect against non-conforming synchronous callbacks and
                  // very large symlink-heavy directories growing the stack.
                  queueMicrotask(() => resolveNextSymlink(index + 1));
                };
                try {
                  sftp.stat(entry.path, (statError, targetAttrs) => {
                    if (isSettled()) return;
                    if (!statError && targetAttrs) {
                      try {
                        entry.isDirectory = targetAttrs.isDirectory();
                      } catch {
                        // Malformed target attributes leave the lstat result intact.
                      }
                    }
                    continueAfterStat();
                  });
                } catch {
                  // A broken/unsupported link remains visible as a symlink,
                  // using the original readdir metadata.
                  continueAfterStat();
                }
              };
              resolveNextSymlink(0);
            } catch (mappingError) {
              done(mappingError);
            }
          });
        } catch (readStartError) {
          done(readStartError);
        }
      });
    });
  }

  async disconnect(id: string): Promise<void> {
    const pending = this.pendingConnections.get(id);
    if (pending) {
      this.pendingConnections.delete(id);
      pending.reject(new Error(`SSH connection ${id} was cancelled`));
      try { pending.client.end(); } catch {}
    }

    const conn = this.connections.get(id);
    if (conn) {
      // Stop lifecycle events emitted synchronously by close()/end() from
      // being reported as an unexpected connection loss.
      this.connections.delete(id);
      conn.shells.forEach((shell) => {
        try { shell.close(); } catch {}
      });
      conn.pendingWrites.clear();
      for (const cancel of conn.sftpOperations) {
        cancel(new Error(`SSH connection ${id} was closed`));
      }
      conn.sftpOperations.clear();
      for (const handle of conn.shellHandles.values()) {
        handle.cancel(new Error(`SSH connection ${id} was closed`));
      }
      conn.shellHandles.clear();
      conn.client.end();
    }
  }

  listConnections(): Array<{ id: string; host: string; port: number; username?: string }> {
    const result: Array<{ id: string; host: string; port: number; username?: string }> = [];
    this.connections.forEach((conn) => {
      result.push({
        id: conn.id,
        host: conn.config.host,
        port: conn.config.port,
        username: conn.config.username,
      });
    });
    return result;
  }

  cleanup(): void {
    for (const id of Array.from(this.pendingConnections.keys())) {
      void this.disconnect(id);
    }
    this.connections.forEach((_, id) => {
      void this.disconnect(id);
    });
  }

  private withSftp<T>(
    sessionId: string,
    operation: (
      sftp: SFTPWrapper,
      done: (error?: unknown, result?: T) => void,
      isSettled: () => boolean,
    ) => void,
  ): Promise<T> {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return Promise.reject(new Error('A valid SSH session id is required'));
    }
    const connection = this.connections.get(sessionId);
    if (!connection) return Promise.reject(new Error(`SSH session ${sessionId} not found`));

    return new Promise<T>((resolve, reject) => {
      let sftp: SFTPWrapper | null = null;
      let settled = false;
      let cancel: (error: Error) => void;
      const timeout = setTimeout(() => {
        finish(new Error(`SFTP operation timed out for SSH session ${sessionId}`));
      }, SFTP_OPERATION_TIMEOUT_MS);
      timeout.unref?.();

      const finish = (error?: unknown, result?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        connection.sftpOperations.delete(cancel);
        try { sftp?.end(); } catch {}

        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (this.connections.get(sessionId) !== connection) {
          reject(new Error(`SSH session ${sessionId} changed during the SFTP operation`));
          return;
        }
        resolve(result as T);
      };
      cancel = (error) => finish(error);
      connection.sftpOperations.add(cancel);

      try {
        connection.client.sftp((error, channel) => {
          if (settled) {
            try { channel?.end(); } catch {}
            return;
          }
          if (error || !channel) {
            finish(error ?? new Error(`Could not open SFTP for SSH session ${sessionId}`));
            return;
          }
          sftp = channel;
          channel.on?.('error', finish);
          channel.on?.('close', () => {
            finish(new Error(`SFTP channel closed for SSH session ${sessionId}`));
          });
          try {
            operation(channel, finish, () => settled);
          } catch (operationError) {
            finish(operationError);
          }
        });
      } catch (sftpStartError) {
        finish(sftpStartError);
      }
    });
  }

  private lookupHostKey(host: string, port: number): string | undefined {
    return this.hostKeyStore?.lookup(host, port) ?? this.inMemoryHostKeys.get(hostKeyId(host, port));
  }

  private rememberHostKey(host: string, port: number, fingerprint: string): void {
    if (this.hostKeyStore) {
      this.hostKeyStore.remember(host, port, fingerprint);
      return;
    }
    this.inMemoryHostKeys.set(hostKeyId(host, port), fingerprint);
  }

  private migrateHostKey(
    host: string,
    port: number,
    expectedFingerprint: string,
    fingerprint: string,
  ): void {
    if (this.hostKeyStore) {
      if (!this.hostKeyStore.migrate) {
        throw new Error(`Stored SSH host key for ${host}:${port} uses a legacy fingerprint format`);
      }
      this.hostKeyStore.migrate(host, port, expectedFingerprint, fingerprint);
      return;
    }

    const key = hostKeyId(host, port);
    if (this.inMemoryHostKeys.get(key) !== expectedFingerprint) {
      throw new Error(`SSH host key changed for ${host}:${port}`);
    }
    this.inMemoryHostKeys.set(key, fingerprint);
  }
}

function hostKeyFingerprints(hostKey: Buffer): { fingerprint: string; legacyFingerprint: string } {
  const base64 = createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '');
  const hex = createHash('sha256').update(hostKey).digest('hex');
  return {
    fingerprint: `SHA256:${base64}`,
    legacyFingerprint: `sha256:${hex}`,
  };
}

function normalizeUsername(username: string | undefined): string {
  const trimmed = username?.trim();
  if (trimmed) return trimmed;
  try {
    const osUsername = os.userInfo().username?.trim();
    if (osUsername) return osUsername;
  } catch {}
  return process.env.USERNAME || process.env.USER || 'user';
}

function normalizePort(port: number): number {
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22;
}

function validateRemotePath(remotePath: string | undefined): string {
  if (remotePath === undefined) return '.';
  if (typeof remotePath !== 'string' || remotePath.length === 0) {
    throw new Error('A valid remote path is required');
  }
  if (remotePath.length > MAX_REMOTE_PATH_LENGTH) {
    throw new Error(`Remote path exceeds ${MAX_REMOTE_PATH_LENGTH} characters`);
  }
  if (remotePath.includes('\0')) throw new Error('Remote path cannot contain NUL characters');
  return remotePath;
}

function joinRemotePath(directory: string, name: string): string {
  const base = directory.replace(/\/+$/, '') || '/';
  return base === '/' ? `/${name}` : `${base}/${name}`;
}

function isSafeRemoteEntryName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name !== '.' && name !== '..' &&
    !name.includes('/') && !name.includes('\0');
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isoTimestamp(seconds: unknown): string {
  const milliseconds = finiteNumber(seconds) * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function sortFileEntries(entries: FileEntry[]): void {
  entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function hostKeyId(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`;
}
