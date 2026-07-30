export type AgentPhase = 'ready' | 'running' | 'needs-input';
export type TurnOutcome = 'succeeded' | 'failed' | 'interrupted';
export type TerminalTransportStatus = 'exited' | 'disconnected';
export type AgentEventName =
  | 'session.start'
  | 'turn.start'
  | 'attention.request'
  | 'attention.resolve'
  | 'turn.end'
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
};

export interface AgentAwareness {
  provider: string;
  sessionId: string;
  turnId?: string;
  phase: AgentPhase;
  phaseChangedAt: number;
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
  | 'disconnected';

export interface AgentStatus {
  kind: AgentStatusKind;
  label: string;
}

const PROVIDER_LABELS: Record<string, string> = { hermes: 'Hermes' };
const STATUS_PRIORITY: Record<AgentStatusKind, number> = {
  'needs-input': 6,
  running: 5,
  failed: 4,
  interrupted: 3,
  finished: 2,
  exited: 1,
  disconnected: 1,
  ready: 0,
};

export function agentStatus(awareness: AgentAwareness): AgentStatus {
  const provider = PROVIDER_LABELS[awareness.provider]
    ?? awareness.provider.charAt(0).toUpperCase() + awareness.provider.slice(1);
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
  return awareness.reduce<AgentStatus | undefined>((best, item, index) => {
    const status = terminalStatus(item, transport[index]);
    if (!status) return best;
    return !best || STATUS_PRIORITY[status.kind] > STATUS_PRIORITY[best.kind] ? status : best;
  }, undefined);
}

export function terminalStatus(
  awareness: AgentAwareness | undefined,
  transport?: TerminalTransportStatus,
): AgentStatus | undefined {
  const status = awareness ? agentStatus(awareness) : undefined;
  if (status && status.kind !== 'ready') return status;
  if (transport === 'exited') return { kind: 'exited', label: 'Exited' };
  if (transport === 'disconnected') return { kind: 'disconnected', label: 'SSH disconnected' };
  return status;
}

export function applyAgentEvent(
  current: AgentAwareness | undefined,
  event: AgentLifecycleEvent,
  occurredAt: number,
  owningTabActive: boolean,
): AgentAwareness | undefined {
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
    return {
      provider: event.provider,
      sessionId: event.sessionId,
      phase: 'ready',
      phaseChangedAt: occurredAt,
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
  const withTurn = event.turnId ? { ...base, turnId: event.turnId } : base;

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
