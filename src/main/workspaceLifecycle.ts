export type WorkspaceCloseDecision = 'background' | 'stop' | 'cancel';

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
  stopAll(): Promise<void>;
  quit(): void;
  /** Return false when JaneT cannot provide a reliable way to reopen a hidden workspace. */
  onBackgroundChange(active: boolean): boolean;
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
    return this.stopAndQuit();
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
      if (quitIntent || this.quitIntentPending) this.dependencies.quit();
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
      await this.stopAndQuit();
    }
  }

  private stopAndQuit(): Promise<void> {
    if (this.stopRequest) return this.stopRequest;
    const request = (async () => {
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
