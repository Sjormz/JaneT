import { describe, expect, it } from 'vitest';
import {
  acknowledgeAgentAwareness,
  agentStatus,
  aggregateAgentStatus,
  terminalStatus,
  applyAgentEvent,
  type AgentLifecycleEvent,
} from '../../src/renderer/terminalAwareness';

function event(
  name: AgentLifecycleEvent['event'],
  extra: Partial<AgentLifecycleEvent> = {},
): AgentLifecycleEvent {
  return {
    version: 1,
    provider: 'hermes',
    event: name,
    sessionId: 'session-1',
    ...extra,
  } as AgentLifecycleEvent;
}

describe('terminal agent awareness', () => {
  it('tracks live phase independently from the last turn outcome', () => {
    let state = applyAgentEvent(undefined, event('session.start'), 10, true);
    expect(state).toMatchObject({ phase: 'ready', phaseChangedAt: 10 });

    state = applyAgentEvent(state, event('turn.start', { turnId: 'turn-1' }), 20, true);
    expect(state).toMatchObject({ phase: 'running', turnId: 'turn-1', phaseChangedAt: 20 });

    state = applyAgentEvent(state, event('attention.request', { turnId: 'turn-1' }), 30, true);
    expect(state).toMatchObject({ phase: 'needs-input', phaseChangedAt: 30 });

    state = applyAgentEvent(state, event('attention.resolve', { turnId: 'turn-1' }), 40, true);
    expect(state).toMatchObject({ phase: 'running', phaseChangedAt: 40 });

    state = applyAgentEvent(state, event('turn.end', {
      turnId: 'turn-1', outcome: 'succeeded',
    }), 50, true);
    expect(state).toMatchObject({
      phase: 'ready',
      phaseChangedAt: 50,
      lastTurn: { outcome: 'succeeded', endedAt: 50, unseen: false },
    });
  });

  it('marks a background outcome unseen and acknowledges it without changing live phase', () => {
    let state = applyAgentEvent(undefined, event('turn.start'), 10, false);
    state = applyAgentEvent(state, event('turn.end', { outcome: 'failed' }), 20, false);

    expect(state?.phase).toBe('ready');
    expect(state?.lastTurn).toEqual({ outcome: 'failed', endedAt: 20, unseen: true });
    expect(acknowledgeAgentAwareness(state!)).toEqual({
      ...state,
      lastTurn: { outcome: 'failed', endedAt: 20, unseen: false },
    });
  });

  it('clears the matching session and ignores stale events from another session', () => {
    const current = applyAgentEvent(undefined, event('turn.start'), 10, true)!;
    expect(applyAgentEvent(current, event('turn.end', {
      sessionId: 'stale-session', outcome: 'succeeded',
    }), 20, false)).toBe(current);
    expect(applyAgentEvent(current, event('session.end'), 30, true)).toBeUndefined();
  });

  it('allows a new session to replace stale state and can recover when its start event was missed', () => {
    const old = applyAgentEvent(undefined, event('session.start'), 10, true)!;
    const next = applyAgentEvent(old, event('session.start', { sessionId: 'session-2' }), 20, true);
    expect(next).toMatchObject({ sessionId: 'session-2', phase: 'ready' });

    const recovered = applyAgentEvent(undefined, event('attention.request', {
      sessionId: 'session-3', turnId: 'turn-3',
    }), 30, false);
    expect(recovered).toMatchObject({
      sessionId: 'session-3', turnId: 'turn-3', phase: 'needs-input',
    });
  });

  it('ignores delayed events from a superseded turn in the same session', () => {
    let state = applyAgentEvent(undefined, event('turn.start', { turnId: 'turn-a' }), 10, true)!;
    state = applyAgentEvent(state, event('turn.start', { turnId: 'turn-b' }), 20, true)!;

    const afterStaleEnd = applyAgentEvent(state, event('turn.end', {
      turnId: 'turn-a', outcome: 'succeeded',
    }), 30, false);
    expect(afterStaleEnd).toBe(state);
    expect(afterStaleEnd).toMatchObject({ phase: 'running', turnId: 'turn-b' });
    expect(applyAgentEvent(state, event('attention.request', { turnId: 'turn-a' }), 40, false))
      .toBe(state);
  });

  it('projects live agent status only while its transport is healthy', () => {
    const ready = applyAgentEvent(undefined, event('session.start'), 10, true)!;
    const running = applyAgentEvent(ready, event('turn.start'), 20, false)!;
    const failed = applyAgentEvent(running, event('turn.end', { outcome: 'failed' }), 30, false)!;
    const attention = applyAgentEvent(running, event('attention.request'), 40, false)!;

    expect(agentStatus(ready)).toMatchObject({ kind: 'ready', label: 'Hermes · Ready' });
    expect(agentStatus(running)).toMatchObject({ kind: 'running', label: 'Hermes · Running' });
    expect(agentStatus(failed)).toMatchObject({ kind: 'failed', label: 'Hermes · Turn failed' });
    expect(agentStatus(attention)).toMatchObject({ kind: 'needs-input', label: 'Hermes · Needs input' });
    expect(aggregateAgentStatus([failed, running, attention])).toEqual(agentStatus(attention));
    expect(terminalStatus(ready, 'exited')).toEqual({ kind: 'exited', label: 'Exited' });
    expect(terminalStatus(running, 'disconnected')).toEqual({ kind: 'disconnected', label: 'SSH disconnected' });
    expect(terminalStatus(attention, 'exited')).toEqual({ kind: 'exited', label: 'Exited' });
    expect(terminalStatus(failed, 'disconnected')).toEqual({ kind: 'disconnected', label: 'SSH disconnected' });
    expect(aggregateAgentStatus(
      [ready, undefined],
      [undefined, 'disconnected'],
    )).toEqual({ kind: 'disconnected', label: 'SSH disconnected' });
  });
});
