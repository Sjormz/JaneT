import { describe, expect, it } from 'vitest';
import { decodeAgentOsc } from '../../src/renderer/agentOsc';

function payload(value: unknown, provider = 'hermes'): string {
  return `janet-agent;${provider};${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}

const turnStart = {
  version: 1,
  event: 'turn.start',
  sessionId: 'session-1',
  turnId: 'turn-1',
};

describe('decodeAgentOsc', () => {
  it('decodes a bounded namespaced lifecycle event', () => {
    expect(decodeAgentOsc(payload(turnStart))).toEqual({
      recognized: true,
      event: { provider: 'hermes', ...turnStart },
    });
  });

  it('leaves unrelated OSC 777 payloads unhandled', () => {
    expect(decodeAgentOsc('notify;Build finished')).toEqual({ recognized: false });
    expect(decodeAgentOsc('janet-other;hermes;payload')).toEqual({ recognized: false });
  });

  it.each([
    ['invalid provider', payload(turnStart, 'Hermes!')],
    ['missing provider and payload', 'janet-agent'],
    ['missing payload', 'janet-agent;hermes'],
    ['invalid base64url', 'janet-agent;hermes;%%%'],
    ['invalid JSON', `janet-agent;hermes;${Buffer.from('{').toString('base64url')}`],
    ['unknown version', payload({ ...turnStart, version: 2 })],
    ['unknown event', payload({ ...turnStart, event: 'tool.call' })],
    ['unknown field', payload({ ...turnStart, command: 'rm -rf /' })],
    ['missing session', payload({ version: 1, event: 'turn.start' })],
    ['missing turn on start', payload({ version: 1, event: 'turn.start', sessionId: 'session-1' })],
    ['missing turn on attention', payload({ version: 1, event: 'attention.request', sessionId: 'session-1' })],
    ['missing turn on end', payload({
      version: 1, event: 'turn.end', sessionId: 'session-1', outcome: 'succeeded',
    })],
    ['outcome on start', payload({ ...turnStart, outcome: 'succeeded' })],
    ['missing turn outcome', payload({ version: 1, event: 'turn.end', sessionId: 'session-1' })],
    ['oversized id', payload({ ...turnStart, sessionId: 'x'.repeat(257) })],
    ['control in id', payload({ ...turnStart, sessionId: 'bad\u001b-id' })],
    ['oversized payload', `janet-agent;hermes;${'a'.repeat(8193)}`],
  ])('consumes but rejects a recognized %s payload', (_name, data) => {
    expect(decodeAgentOsc(data)).toEqual({ recognized: true });
  });

  it('accepts each lifecycle event with only its valid fields', () => {
    const cases = [
      { version: 1, event: 'session.start', sessionId: 's' },
      { version: 1, event: 'turn.start', sessionId: 's', turnId: 't' },
      { version: 1, event: 'attention.request', sessionId: 's', turnId: 't' },
      { version: 1, event: 'attention.resolve', sessionId: 's', turnId: 't' },
      { version: 1, event: 'turn.end', sessionId: 's', turnId: 't', outcome: 'failed' },
      { version: 1, event: 'session.end', sessionId: 's' },
    ];

    for (const value of cases) {
      expect(decodeAgentOsc(payload(value))).toEqual({
        recognized: true,
        event: { provider: 'hermes', ...value },
      });
    }
  });
});
