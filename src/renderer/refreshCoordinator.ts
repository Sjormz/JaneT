import { useEffect, useRef } from 'react';

export type RefreshReason =
  | 'register'
  | 'heartbeat'
  | 'focus'
  | 'visibility'
  | 'manual'
  | 'prompt'
  | 'mutation';

export type RefreshRunner = (reason: RefreshReason) => void | Promise<void>;

interface RefreshTask {
  key: string;
  intervalMs: number;
  run: RefreshRunner;
  nextRunAt: number;
  running: boolean;
  pendingReason: RefreshReason | null;
}

const DEFAULT_HEARTBEAT_RESOLUTION_MS = 1_000;
const BACKGROUND_REASONS = new Set<RefreshReason>(['heartbeat', 'prompt', 'mutation']);

/**
 * Coordinates periodic and event-driven renderer refreshes through one timer.
 * Tasks are single-flight: invalidations received during a run are collapsed
 * into one follow-up run.
 */
export class RefreshCoordinator {
  private readonly tasks = new Map<string, RefreshTask>();
  private readonly heartbeatResolutionMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private listenersAttached = false;
  private windowFocused = true;

  constructor(heartbeatResolutionMs = DEFAULT_HEARTBEAT_RESOLUTION_MS) {
    this.heartbeatResolutionMs = normalizeDuration(heartbeatResolutionMs, DEFAULT_HEARTBEAT_RESOLUTION_MS);
  }

  register(key: string, intervalMs: number, run: RefreshRunner): () => void {
    const normalizedInterval = normalizeDuration(intervalMs, 0);
    const existing = this.tasks.get(key);

    // Treat an identical registration as a no-op. This keeps development
    // remounts and repeated setup calls from producing duplicate work.
    if (existing && existing.intervalMs === normalizedInterval && existing.run === run) {
      return this.createCleanup(key, existing);
    }

    const task: RefreshTask = {
      key,
      intervalMs: normalizedInterval,
      run,
      nextRunAt: Date.now() + normalizedInterval,
      running: false,
      pendingReason: null,
    };

    this.tasks.set(key, task);
    this.startInfrastructure();
    this.runTask(task, 'register');

    return this.createCleanup(key, task);
  }

  unregister(key: string): void {
    if (!this.tasks.delete(key)) return;
    if (this.tasks.size === 0) this.stopInfrastructure();
  }

  invalidate(reason: RefreshReason, key?: string): void {
    if (this.shouldPause(reason)) return;

    if (key !== undefined) {
      const task = this.tasks.get(key);
      if (task) this.runTask(task, reason);
      return;
    }

    for (const task of this.tasks.values()) this.runTask(task, reason);
  }

  dispose(): void {
    this.tasks.clear();
    this.stopInfrastructure();
  }

  private createCleanup(key: string, task: RefreshTask): () => void {
    let cleanedUp = false;
    return () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (this.tasks.get(key) === task) this.unregister(key);
    };
  }

  private startInfrastructure(): void {
    if (this.tasks.size === 0) return;

    if (!this.listenersAttached && typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.windowFocused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      window.addEventListener('focus', this.handleFocus);
      window.addEventListener('blur', this.handleBlur);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      this.listenersAttached = true;
    }

    if (this.heartbeatTimer === null) {
      this.heartbeatTimer = setInterval(this.handleHeartbeat, this.heartbeatResolutionMs);
    }
  }

  private stopInfrastructure(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.listenersAttached && typeof window !== 'undefined' && typeof document !== 'undefined') {
      window.removeEventListener('focus', this.handleFocus);
      window.removeEventListener('blur', this.handleBlur);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.listenersAttached = false;
    }
  }

  private readonly handleHeartbeat = (): void => {
    if (!this.isActive()) return;

    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (now >= task.nextRunAt) this.runTask(task, 'heartbeat');
    }
  };

  private readonly handleFocus = (): void => {
    this.windowFocused = true;
    if (!this.isDocumentHidden()) this.invalidate('focus');
  };

  private readonly handleBlur = (): void => {
    this.windowFocused = false;
  };

  private readonly handleVisibilityChange = (): void => {
    if (!this.isDocumentHidden()) this.invalidate('visibility');
  };

  private shouldPause(reason: RefreshReason): boolean {
    return BACKGROUND_REASONS.has(reason) && !this.isActive();
  }

  private isActive(): boolean {
    return this.windowFocused && !this.isDocumentHidden();
  }

  private isDocumentHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private runTask(task: RefreshTask, reason: RefreshReason): void {
    if (this.tasks.get(task.key) !== task) return;

    if (task.running) {
      // Periodic ticks are a fallback, not a backlog. A slow task should get
      // its next interval after it finishes instead of running continuously.
      if (reason === 'heartbeat') return;
      // Do not let a later timer tick erase a more specific pending cause.
      task.pendingReason = reason;
      return;
    }

    task.running = true;
    task.nextRunAt = Date.now() + task.intervalMs;

    let result: void | Promise<void>;
    try {
      result = task.run(reason);
    } catch {
      // Finish on the same async boundary as a fulfilled/rejected runner. This
      // also prevents a self-invalidating, throwing runner from recursing.
      result = undefined;
    }

    void Promise.resolve(result).then(
      () => this.finishTask(task),
      () => this.finishTask(task),
    );
  }

  private finishTask(task: RefreshTask): void {
    task.running = false;
    if (this.tasks.get(task.key) !== task) return;
    task.nextRunAt = Date.now() + task.intervalMs;

    const followUpReason = task.pendingReason;
    task.pendingReason = null;
    if (followUpReason !== null) this.runTask(task, followUpReason);
  }
}

function normalizeDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const refreshCoordinator = new RefreshCoordinator();

export interface UseRefreshTaskOptions {
  key: string;
  intervalMs: number;
  enabled?: boolean;
  run: RefreshRunner;
}

export function useRefreshTask(
  { key, intervalMs, enabled = true, run }: UseRefreshTaskOptions,
  coordinator: RefreshCoordinator = refreshCoordinator,
): void {
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (!enabled) return undefined;
    return coordinator.register(key, intervalMs, (reason) => runRef.current(reason));
  }, [coordinator, enabled, intervalMs, key]);
}
