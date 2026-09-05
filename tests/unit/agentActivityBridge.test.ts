import { describe, it, expect } from 'vitest';
import { AgentActivityBridge, codexActivity, CODEX_ACTIVITY_SCRIPT } from '../../src/main/agentActivityBridge';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

describe('Codex activity', () => {
  it('validates setup health separately and keeps incomplete tracking on later Codex events', async () => {
    const events: any[] = [];
    const bridge = new AgentActivityBridge((_id, event) => events.push(event));
    try {
      const env = await bridge.environment('one');
      const post = (value: unknown) => fetch(env.JANET_ACTIVITY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      const status = { provider: 'codex', event: 'integration.status', available: false };
      expect((await post({ ...status, private: 'reject' })).status).toBe(400);
      expect((await post({ ...status, available: 'false' })).status).toBe(400);
      await post(status);
      await post({ event: 'UserPromptSubmit', sessionId: 'session', turnId: 'turn' });
      expect(events.at(-1)).toMatchObject({ event: 'turn.start', completionTracking: false });
      await post({ ...status, available: true });
      await post({ event: 'agent-turn-complete', sessionId: 'session', turnId: 'turn' });
      expect(events.at(-1)).toMatchObject({ event: 'turn.end', completionTracking: true });
      bridge.remove('one');
      expect((await post(status)).status).toBe(403);
    } finally { bridge.close(); }
  });
  it('preserves the active turn across compaction and rejects unrelated or private events', async () => {
    const events: any[] = [];
    const bridge = new AgentActivityBridge((_id, event) => events.push(event));
    try {
      const env = await bridge.environment('one');
      const post = (value: unknown) => fetch(env.JANET_ACTIVITY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      const base = { version: 1, provider: 'codex', sessionId: 'session' };
      await post({ ...base, event: 'session.start' });
      await post({ ...base, event: 'turn.start', turnId: 'turn' });
      await post({ ...base, event: 'session.start' });
      await post({ ...base, event: 'turn.end', turnId: 'child', outcome: 'succeeded' });
      expect((await post({ ...base, event: 'turn.end', turnId: 'turn', outcome: 'succeeded', prompt: 'private' })).status).toBe(400);
      await post({ ...base, event: 'turn.end', turnId: 'turn', outcome: 'succeeded' });
      expect(events.map(event => event.event)).toEqual(['session.start', 'turn.start', 'session.start', 'turn.end']);
    } finally { bridge.close(); }
  });
  it('maps documented lifecycle events without treating Stop/tool failure as turn completion', () => {
    const input = { sessionId: 'session', turnId: 'turn' };
    expect(codexActivity({ ...input, event: 'UserPromptSubmit' })).toMatchObject({ provider: 'codex', event: 'turn.start' });
    expect(codexActivity({ ...input, event: 'PermissionRequest' })).toMatchObject({ event: 'attention.request' });
    expect(codexActivity({ ...input, event: 'agent-turn-complete' })).toMatchObject({ event: 'turn.end', outcome: 'succeeded' });
    expect(codexActivity({ ...input, event: 'Interrupt' })).toMatchObject({ outcome: 'interrupted' });
    expect(codexActivity({ ...input, event: 'Stop' })).toBeNull();
    expect(codexActivity({ ...input, event: 'constructor' })).toBeNull();
    expect(codexActivity({ ...input, event: 'UserPromptSubmit', prompt: 'private' })).toBeNull();
    expect(codexActivity({ ...input, sessionId: '\0', event: 'SessionStart' })).toBeNull();
  });

  it('routes the real hook helper by terminal capability and drops closed identities', async () => {
    const received: unknown[] = [];
    const bridge = new AgentActivityBridge((id, event) => received.push({ id, event }));
    const directory = mkdtempSync(join(tmpdir(), 'janet-agent-test-'));
    try {
      const env = await bridge.environment('one');
      await bridge.environment('two');
      const script = join(directory, 'hook.cjs'); writeFileSync(script, CODEX_ACTIVITY_SCRIPT);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, windowsHide: true });
        child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(String(code))));
        child.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's', turn_id: 't', prompt: 'must not forward' }));
      });
      expect(received).toEqual([
        { id: 'one', event: { version: 1, provider: 'codex', event: 'session.start', sessionId: 's' } },
        { id: 'one', event: { version: 1, provider: 'codex', event: 'turn.start', sessionId: 's', turnId: 't' } },
      ]);
      const response = await fetch(env.JANET_ACTIVITY_URL, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' });
      expect(response.status).toBe(403);
      bridge.remove('one');
      expect((await fetch(env.JANET_ACTIVITY_URL, { method: 'POST' })).status).toBe(403);
    } finally { bridge.close(); rmSync(directory, { recursive: true, force: true }); }
  });

});
