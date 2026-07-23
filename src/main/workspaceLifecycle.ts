export type WorkspaceCloseReason = 'window-close' | 'application-quit' | 'update-install';
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

export interface WorkspaceLifecycleDependencies {
  requestClosePreparation(reason: WorkspaceCloseReason): Promise<WorkspacePrepareForCloseDecision>;
  stopAll(): Promise<void>;
  quit(): void;
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

/** Owns the single main-to-renderer dirty-editor close handshake. */
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

  resolve(renderer: WorkspaceCloseRenderer, value: unknown): boolean {
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

export class WorkspaceLifecycleController {
  private closeRequest: Promise<void> | null = null;

  constructor(private readonly dependencies: WorkspaceLifecycleDependencies) {}

  handleClose(): Promise<void> {
    return this.stopAndQuit('window-close');
  }

  handleQuit(): Promise<void> {
    return this.stopAndQuit('application-quit');
  }

  async prepareForClose(reason: WorkspaceCloseReason): Promise<boolean> {
    const decision = await this.dependencies.requestClosePreparation(reason);
    return decision === 'saved' || decision === 'discarded';
  }

  private stopAndQuit(reason: WorkspaceCloseReason): Promise<void> {
    if (this.closeRequest) return this.closeRequest;
    const request = (async () => {
      if (!await this.prepareForClose(reason)) return;
      await this.dependencies.stopAll();
      this.dependencies.quit();
    })().finally(() => {
      if (this.closeRequest === request) this.closeRequest = null;
    });
    this.closeRequest = request;
    return request;
  }
}
