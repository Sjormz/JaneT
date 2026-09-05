export type AgentPhase = 'ready' | 'running' | 'needs-input' | 'connecting';
export type TurnOutcome = 'succeeded' | 'failed' | 'interrupted';
export type TerminalTransportStatus = 'exited' | 'disconnected';
export type AgentEventName =
  | 'session.start'
  | 'turn.start'
  | 'attention.request'
  | 'attention.resolve'
  | 'turn.end'
  | 'integration.status'
  | 'session.end';

interface AgentEventBase {
  version: 1;
  provider: string;
  event: AgentEventName;
  sessionId: string;
  turnId?: string;
}

export type AgentLifecycleEvent = AgentEventBase & {
  outcome?: TurnOutcome;
  /** Main-process setup health, never accepted from terminal OSC payloads. */
  completionTracking?: boolean;
};

export interface AgentAwareness {
  provider: string;
  sessionId: string;
  turnId?: string;
  phase: AgentPhase;
  phaseChangedAt: number;
  completionTracking?: boolean;
  lastTurn?: {
    outcome: TurnOutcome;
    endedAt: number;
    unseen: boolean;
  };
}

export type AgentStatusKind =
  | 'ready'
  | 'running'
  | 'needs-input'
  | 'finished'
  | 'failed'
  | 'interrupted'
  | 'exited'
  | 'unavailable'
  | 'disconnected';

export interface AgentStatus {
  kind: AgentStatusKind;
  label: string;
  busyCount?: number;
  unseenCount?: number;
}

const PROVIDER_LABELS: Record<string, string> = { hermes: 'Hermes', codex: 'Codex', shell: 'Shell' };
const STATUS_PRIORITY: Record<AgentStatusKind, number> = {
  'needs-input': 6,
  running: 5,
  failed: 4,
  unavailable: 3,
  interrupted: 3,
  finished: 2,
  exited: 1,
  disconnected: 1,
  ready: 0,
};

export function agentStatus(awareness: AgentAwareness): AgentStatus {
  const provider = PROVIDER_LABELS[awareness.provider]
    ?? awareness.provider.charAt(0).toUpperCase() + awareness.provider.slice(1);
  if (awareness.completionTracking === false) return { kind: 'unavailable', label: `${provider} · Activity tracking incomplete` };
  if (awareness.phase === 'connecting') return { kind: 'unavailable', label: `${provider} · Awaiting activity` };
  if (awareness.phase === 'needs-input') return { kind: 'needs-input', label: `${provider} · Needs input` };
  if (awareness.phase === 'running') return { kind: 'running', label: `${provider} · Running` };
  if (awareness.lastTurn?.unseen) {
    if (awareness.lastTurn.outcome === 'failed') return { kind: 'failed', label: `${provider} · Turn failed` };
    if (awareness.lastTurn.outcome === 'interrupted') return { kind: 'interrupted', label: `${provider} · Interrupted` };
    return { kind: 'finished', label: `${provider} · Turn finished` };
  }
  return { kind: 'ready', label: `${provider} · Ready` };
}

export function aggregateAgentStatus(
  awareness: Array<AgentAwareness | undefined>,
  transport: Array<TerminalTransportStatus | undefined> = [],
): AgentStatus | undefined {
  const best = awareness.reduce<AgentStatus | undefined>((best, item, index) => {
    const status = terminalStatus(item, transport[index]);
    if (!status) return best;
    return !best || STATUS_PRIORITY[status.kind] > STATUS_PRIORITY[best.kind] ? status : best;
  }, undefined);
  if (!best) return undefined;
  const busyCount = awareness.filter((item, i) => !transport[i] && item?.completionTracking !== false && item?.phase === 'running').length;
  const unseenCount = awareness.filter((item) => item?.lastTurn?.unseen).length;
  return { ...best, busyCount, unseenCount,
    label: `${best.label}${busyCount ? ` · ${busyCount} busy` : ''}${unseenCount ? ` · ${unseenCount} unread` : ''}` };
}

export function terminalStatus(
  awareness: AgentAwareness | undefined,
  transport?: TerminalTransportStatus,
): AgentStatus | undefined {
  if (transport === 'exited') return { kind: 'exited', label: 'Exited' };
  if (transport === 'disconnected') return { kind: 'disconnected', label: 'SSH disconnected' };
  return awareness ? agentStatus(awareness) : undefined;
}

export function applyAgentEvent(
  current: AgentAwareness | undefined,
  event: AgentLifecycleEvent,
  occurredAt: number,
  owningTabActive: boolean,
): AgentAwareness | undefined {
  if (event.event === 'integration.status') {
    if (event.completionTracking) {
      if (current?.provider === event.provider && current.sessionId !== 'janet-codex-setup') return { ...current, completionTracking: true };
      return { provider: event.provider, sessionId: event.sessionId, phase: 'connecting', phaseChangedAt: occurredAt, completionTracking: true };
    }
    return { ...(current?.provider === event.provider ? current : {
      provider: event.provider, sessionId: event.sessionId, phase: 'ready', phaseChangedAt: occurredAt,
    }), completionTracking: false };
  }
  // Prompt redraws don't acknowledge results or replace an active agent session.
  if (event.provider === 'shell' && event.event === 'session.start' && current) return current;
  if (event.provider === 'shell' && current && current.provider !== 'shell' && event.event !== 'turn.end') return current;
  if (event.provider === 'shell' && event.event === 'turn.end' && current?.provider !== 'shell') current = undefined;
  if (current?.provider === 'shell' && event.provider !== 'shell') current = undefined;
  if (event.event === 'session.end') {
    return current?.provider === event.provider && current.sessionId === event.sessionId
      ? undefined
      : current;
  }

  if (
    current
    && (current.provider !== event.provider || current.sessionId !== event.sessionId)
    && event.event !== 'session.start'
  ) return current;

  if (event.event === 'session.start') {
    if (current?.provider === event.provider && current.sessionId === event.sessionId) return current;
    return {
      provider: event.provider,
      sessionId: event.sessionId,
      phase: 'ready',
      phaseChangedAt: occurredAt,
      ...(event.completionTracking !== undefined ? { completionTracking: event.completionTracking } : {}),
    };
  }

  if (
    event.event !== 'turn.start'
    && current?.turnId
    && event.turnId
    && current.turnId !== event.turnId
  ) return current;

  const base: AgentAwareness = current ?? {
    provider: event.provider,
    sessionId: event.sessionId,
    phase: 'ready',
    phaseChangedAt: occurredAt,
  };
  if (base.lastTurn && base.phase === 'ready' && base.turnId === event.turnId && event.event !== 'turn.start') return current;
  const withTurn = { ...base, ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(event.completionTracking !== undefined ? { completionTracking: event.completionTracking } : {}) };

  if (event.event === 'turn.start' || event.event === 'attention.resolve') {
    return { ...withTurn, phase: 'running', phaseChangedAt: occurredAt };
  }
  if (event.event === 'attention.request') {
    return { ...withTurn, phase: 'needs-input', phaseChangedAt: occurredAt };
  }
  return {
    ...withTurn,
    phase: 'ready',
    phaseChangedAt: occurredAt,
    lastTurn: {
      outcome: event.outcome!,
      endedAt: occurredAt,
      unseen: !owningTabActive,
    },
  };
}

export function acknowledgeAgentAwareness(awareness: AgentAwareness): AgentAwareness {
  if (!awareness.lastTurn?.unseen) return awareness;
  return {
    ...awareness,
    lastTurn: { ...awareness.lastTurn, unseen: false },
  };
}
