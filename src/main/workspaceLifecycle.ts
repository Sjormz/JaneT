export type WorkspaceCloseReason = 'window-close' | 'application-quit' | 'update-install';
export type WorkspacePrepareForCloseDecision = 'saved' | 'discarded' | 'cancel';

export const WORKSPACE_PREPARE_FOR_CLOSE_CHANNEL = 'workspace:prepareForClose';
export const WORKSPACE_RESOLVE_PREPARE_FOR_CLOSE_CHANNEL = 'workspace:resolvePrepareForClose';
export const WORKSPACE_AWAIT_USER_FOR_CLOSE_CHANNEL = 'workspace:awaitUserForClose';

export interface WorkspacePrepareForCloseRequest {
  requestId: string;
  reason: WorkspaceCloseReason;
}

/** Renderer acknowledgement that it is showing the user a close prompt. */
export interface WorkspacePrepareForCloseAcknowledgement {
  requestId: string;
}

type RendererUnavailableEvent = 'destroyed' | 'render-process-gone' | 'did-navigate';
const RENDERER_UNAVAILABLE_EVENTS: readonly RendererUnavailableEvent[] = ['destroyed', 'render-process-gone', 'did-navigate'];

export interface WorkspacePrepareForCloseResolution {
  requestId: string;
  resolution: WorkspacePrepareForCloseDecision;
}

export interface WorkspaceCloseRenderer {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  once(event: RendererUnavailableEvent, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: RendererUnavailableEvent, listener: (...args: unknown[]) => void): unknown;
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
  /** Null once the renderer acknowledged a user prompt: then only the user or renderer loss settles it. */
  timeout: ReturnType<typeof setTimeout> | null;
}

function isPrepareForCloseDecision(value: unknown): value is WorkspacePrepareForCloseDecision {
  return value === 'saved' || value === 'discarded' || value === 'cancel';
}

/**
 * Owns the single main-to-renderer dirty-editor close handshake.
 *
 * The timeout only protects against a renderer that never answers. Once the
 * renderer acknowledges that it is asking the user (for example "Save changes
 * before closing?"), the request waits for the user's decision, and is
 * cancelled only if the renderer is destroyed, crashes or navigates away.
 */
export class WorkspaceClosePreparationCoordinator {
  private nextRequestId = 1;
  private pending: PendingClosePreparation | null = null;

  constructor(private readonly timeoutMs = 30_000) {}

  /** Stop the unresponsive-renderer timeout because the user is being asked. */
  awaitUser(renderer: WorkspaceCloseRenderer, value: unknown): boolean {
    const pending = this.pending;
    if (
      !pending
      || pending.renderer !== renderer
      || typeof value !== 'object'
      || value === null
      || (value as Partial<WorkspacePrepareForCloseAcknowledgement>).requestId !== pending.request.requestId
    ) {
      return false;
    }
    if (pending.timeout) clearTimeout(pending.timeout);
    pending.timeout = null;
    return true;
  }

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
    const pending = {} as PendingClosePreparation;
    Object.assign(pending, {
      request,
      renderer,
      promise,
      resolve: resolvePromise,
      onUnavailable: () => this.settle(pending, 'cancel'),
      timeout: setTimeout(() => this.settle(pending, 'cancel'), this.timeoutMs),
    });
    pending.timeout?.unref?.();
    this.pending = pending;

    try {
      for (const event of RENDERER_UNAVAILABLE_EVENTS) renderer.once(event, pending.onUnavailable);
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
    if (pending.timeout) clearTimeout(pending.timeout);
    try {
      for (const event of RENDERER_UNAVAILABLE_EVENTS) pending.renderer.removeListener(event, pending.onUnavailable);
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
