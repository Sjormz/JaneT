export type WorkspaceCloseDecision = 'background' | 'stop' | 'cancel';
export type WorkspaceCloseReason = 'window-close' | 'application-quit' | 'tray-stop' | 'update-install';
export type WorkspacePrepareForCloseDecision = 'saved' | 'discarded' | 'cancel';

export const WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL = 'workspace:prepareForClose';
export const WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL = 'workspace:resolvePrepareForClose';

export interface WorkspacePrepareForCloseRequest {
  requestId: string;
  reason: WorkspaceCloseReason;
}

export interface WorkspacePrepareForCloseResolution {
  requestId: string;
  resolution: WorkspacePrepareForCloseDecision;
}

export interface WorkspaceCloseRenderer {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: 'destroyed' | 'render-process-gone', listener: (...args: unknown[]) => void): unknown;
  removeListener(event: 'destroyed' | 'render-process-gone', listener: (...args: unknown[]) => void): unknown;
}

export interface WorkspaceActivity {
  localTerminals: number;
  sshSessions: number;
  localDetails?: string[];
  sshDetails?: string[];
}

export interface WorkspaceClosePrompt {
  title: string;
  message: string;
  detail: string;
  actions: Array<{ decision: WorkspaceCloseDecision; label: string }>;
  defaultDecision: WorkspaceCloseDecision;
  cancelDecision: WorkspaceCloseDecision;
}

export interface WorkspaceWindow {
  close(): void;
  hide(): void;
  show(): void;
  focus(): void;
  isDestroyed(): boolean;
}

export interface WorkspaceLifecycleDependencies {
  getActivity(): WorkspaceActivity | Promise<WorkspaceActivity>;
  chooseDecision(prompt: WorkspaceClosePrompt): Promise<WorkspaceCloseDecision>;
  requestClosePreparation(reason: WorkspaceCloseReason): Promise<WorkspacePrepareForCloseDecision>;
  stopAll(): Promise<void>;
  quit(): void;
  /** Return false when JaneT cannot provide a reliable way to reopen a hidden workspace. */
  onBackgroundChange(active: boolean): boolean;
}

interface PendingClosePreparation {
  request: WorkspacePrepareForCloseRequest;
  renderer: WorkspaceCloseRenderer;
  promise: Promise<WorkspacePrepareForCloseDecision>;
  resolve(decision: WorkspacePrepareForCloseDecision): void;
  onUnavailable(): void;
}

function isPrepareForCloseDecision(value: unknown): value is WorkspacePrepareForCloseDecision {
  return value === 'saved' || value === 'discarded' || value === 'cancel';
}

/**
 * Owns the single main-to-renderer close preparation handshake. Keeping this
 * state in the main process makes duplicate close signals safe and lets the
 * main process reject replies from an old renderer or an already-settled
 * request.
 */
export class WorkspaceClosePreparationCoordinator {
  private nextRequestId = 1;
  private pending: PendingClosePreparation | null = null;

  request(
    renderer: WorkspaceCloseRenderer,
    reason: WorkspaceCloseReason,
  ): Promise<WorkspacePrepareForCloseDecision> {
    if (this.pending) {
      return this.pending.renderer === renderer
        ? this.pending.promise
        : Promise.resolve('cancel');
    }
    if (renderer.isDestroyed()) return Promise.resolve('cancel');

    const request: WorkspacePrepareForCloseRequest = {
      requestId: `workspace-close-${this.nextRequestId++}`,
      reason,
    };
    let resolvePromise!: (decision: WorkspacePrepareForCloseDecision) => void;
    const promise = new Promise<WorkspacePrepareForCloseDecision>((resolve) => {
      resolvePromise = resolve;
    });
    const pending: PendingClosePreparation = {
      request,
      renderer,
      promise,
      resolve: resolvePromise,
      onUnavailable: () => this.settle(pending, 'cancel'),
    };
    this.pending = pending;

    try {
      renderer.once('destroyed', pending.onUnavailable);
      renderer.once('render-process-gone', pending.onUnavailable);
      if (renderer.isDestroyed()) {
        this.settle(pending, 'cancel');
      } else {
        renderer.send(WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL, request);
      }
    } catch {
      this.settle(pending, 'cancel');
    }
    return promise;
  }

  resolve(
    renderer: WorkspaceCloseRenderer,
    value: unknown,
  ): boolean {
    const pending = this.pending;
    if (
      !pending
      || pending.renderer !== renderer
      || typeof value !== 'object'
      || value === null
    ) {
      return false;
    }
    const resolution = value as Partial<WorkspacePrepareForCloseResolution>;
    if (
      resolution.requestId !== pending.request.requestId
      || !isPrepareForCloseDecision(resolution.resolution)
    ) {
      return false;
    }
    this.settle(pending, resolution.resolution);
    return true;
  }

  private settle(
    pending: PendingClosePreparation,
    decision: WorkspacePrepareForCloseDecision,
  ): void {
    if (this.pending !== pending) return;
    this.pending = null;
    try {
      pending.renderer.removeListener('destroyed', pending.onUnavailable);
      pending.renderer.removeListener('render-process-gone', pending.onUnavailable);
    } catch {}
    pending.resolve(decision);
  }
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function workspaceClosePrompt(activity: WorkspaceActivity): WorkspaceClosePrompt {
  const details: string[] = [];
  if (activity.localTerminals > 0 && !activity.localDetails?.length) {
    details.push(plural(activity.localTerminals, 'terminal with active work', 'terminals with active work'));
  }
  if (activity.sshSessions > 0 && !activity.sshDetails?.length) details.push(plural(activity.sshSessions, 'SSH connection'));
  if (activity.localDetails?.length) {
    details.push('', `${plural(activity.localTerminals, 'terminal with active work', 'terminals with active work')}:`, ...activity.localDetails.map((item) => `• ${item}`));
  }
  if (activity.sshDetails?.length) {
    details.push('', `${plural(activity.sshSessions, 'SSH connection')}:`, ...activity.sshDetails.map((item) => `• ${item}`));
  }
  details.push(
    '',
    'Keeping JaneT running preserves these terminals and connections in the background. Stopping ends JaneT-managed terminals and SSH sessions before quitting.',
    '',
    'Remote jobs detached with tools such as tmux, nohup, systemd, or disown may continue on the remote machine.',
  );
  return {
    title: 'Keep JaneT running?',
    message: 'Terminals or SSH connections are still active.',
    detail: details.join('\n'),
    actions: [
      { decision: 'background', label: 'Keep running in background' },
      { decision: 'stop', label: 'Stop all and quit' },
      { decision: 'cancel', label: 'Cancel' },
    ],
    defaultDecision: 'background',
    cancelDecision: 'cancel',
  };
}

export class WorkspaceLifecycleController {
  private closeRequest: Promise<void> | null = null;
  private stopRequest: Promise<void> | null = null;
  private quitIntentPending = false;

  constructor(private readonly dependencies: WorkspaceLifecycleDependencies) {}

  handleClose(window: WorkspaceWindow): Promise<void> {
    return this.handleRequest(window, false);
  }

  handleQuit(window: WorkspaceWindow): Promise<void> {
    this.quitIntentPending = true;
    return this.handleRequest(window, true);
  }

  private handleRequest(window: WorkspaceWindow, quitIntent: boolean): Promise<void> {
    if (this.closeRequest) return this.closeRequest;
    const request = this.resolveClose(window, quitIntent).finally(() => {
      if (this.closeRequest === request) {
        this.closeRequest = null;
        this.quitIntentPending = false;
      }
    });
    this.closeRequest = request;
    return request;
  }

  show(window: WorkspaceWindow): void {
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
    this.dependencies.onBackgroundChange(false);
  }

  stopFromTray(): Promise<void> {
    return this.stopAndQuit('tray-stop');
  }

  async prepareForClose(reason: WorkspaceCloseReason): Promise<boolean> {
    const decision = await this.dependencies.requestClosePreparation(reason);
    return decision === 'saved' || decision === 'discarded';
  }

  private resolveClose(window: WorkspaceWindow, quitIntent: boolean): Promise<void> {
    const activity = this.dependencies.getActivity();
    return activity instanceof Promise
      ? activity.then((resolved) => this.resolveActivity(window, resolved, quitIntent))
      : this.resolveActivity(window, activity, quitIntent);
  }

  private async resolveActivity(
    window: WorkspaceWindow,
    activity: WorkspaceActivity,
    quitIntent: boolean,
  ): Promise<void> {
    if (window.isDestroyed()) return;

    if (activity.localTerminals <= 0 && activity.sshSessions <= 0) {
      const shouldQuit = quitIntent || this.quitIntentPending;
      const canClose = await this.prepareForClose(shouldQuit ? 'application-quit' : 'window-close');
      if (!canClose || window.isDestroyed()) return;
      if (shouldQuit || this.quitIntentPending) this.dependencies.quit();
      else window.close();
      return;
    }

    const decision = await this.dependencies.chooseDecision(workspaceClosePrompt(activity));
    if (window.isDestroyed()) return;

    if (decision === 'background') {
      if (!this.dependencies.onBackgroundChange(true)) {
        window.show();
        window.focus();
        return;
      }
      try {
        window.hide();
      } catch (error) {
        this.dependencies.onBackgroundChange(false);
        throw error;
      }
      return;
    }
    if (decision === 'stop') {
      await this.stopAndQuit((quitIntent || this.quitIntentPending) ? 'application-quit' : 'window-close');
    }
  }

  private stopAndQuit(reason: WorkspaceCloseReason): Promise<void> {
    if (this.stopRequest) return this.stopRequest;
    const request = (async () => {
      if (!await this.prepareForClose(reason)) return;
      await this.dependencies.stopAll();
      this.dependencies.onBackgroundChange(false);
      this.dependencies.quit();
    })().finally(() => {
      if (this.stopRequest === request) this.stopRequest = null;
    });
    this.stopRequest = request;
    return request;
  }
}
