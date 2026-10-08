import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AgentLifecycleEvent } from '../renderer/terminalAwareness';
import { validateAgentEvent } from '../renderer/agentOsc';
import { activityDiagnostic } from './activityDiagnostics';

/** Local, per-terminal capability. Never accepts commands, transcript paths or tool output. */
export class AgentActivityBridge {
  private server?: Server;
  private opening?: Promise<number>;
  private terminals = new Map<string, string>();
  private active = new Map<string, { provider: string; sessionId: string; turnId?: string; ended?: boolean }>();
  private completionTracking = new Map<string, { provider: string; available: boolean }>();
  constructor(private readonly receive: (id: string, event: AgentLifecycleEvent) => void) {}

  async environment(id: string): Promise<Record<string, string>> {
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('Invalid terminal identity');
    if (!this.terminals.has(id) && this.terminals.size >= 64) throw new Error('Activity terminal limit reached');
    const token = this.terminals.get(id) ?? randomBytes(32).toString('hex');
    this.terminals.set(id, token);
    const port = await (this.opening ??= this.open());
    return { JANET_ACTIVITY_URL: `http://127.0.0.1:${port}/${token}` };
  }
  private forward(id: string, event: AgentLifecycleEvent): void {
    const tracking = this.completionTracking.get(id);
    this.receive(id, tracking?.provider === event.provider ? { ...event, completionTracking: tracking.available } : event);
  }
  remove(id: string): void { this.terminals.delete(id); this.active.delete(id); this.completionTracking.delete(id); }
  close(): void { this.terminals.clear(); this.active.clear(); this.completionTracking.clear(); this.server?.closeAllConnections(); this.server?.close(); this.server = undefined; this.opening = undefined; }
  private open(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = this.server = createServer((req, res) => {
        const id = [...this.terminals].find(([, token]) => req.url === `/${token}`)?.[0];
        if (!id || req.method !== 'POST' || req.headers.origin || req.headers['content-type'] !== 'application/json') {
          res.writeHead(403).end(); req.resume(); return;
        }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
        req.on('error', () => {});
        req.on('end', () => {
          try {
            const payload = JSON.parse(body);
            const { provider, ...data } = payload;
            if ((provider === 'codex' || provider === 'claude') && data.event === 'integration.status') {
              if (Object.keys(data).length !== 2 || typeof data.available !== 'boolean' || req.url !== `/${this.terminals.get(id)}`) { res.writeHead(400).end(); return; }
              this.completionTracking.set(id, { provider, available: data.available });
              const current = this.active.get(id);
              this.receive(id, { version: 1, provider, event: 'integration.status',
                sessionId: current && current.provider === provider ? current.sessionId : setupSessionId(provider), completionTracking: data.available });
              res.writeHead(204).end(); return;
            }
            const event = provider === undefined ? codexActivity(payload)
              : ['codex', 'hermes', 'claude'].includes(provider) ? validateAgentEvent(provider, data) : undefined;
            if (!event || req.url !== `/${this.terminals.get(id)}`) { res.writeHead(400).end(); return; }
            const current = this.active.get(id);
            const sameSession = current?.provider === event.provider && current.sessionId === event.sessionId;
            if (event.event === 'session.start' && !sameSession) this.active.set(id, event);
            else if (event.event === 'session.start') { /* Same-session compaction preserves the active turn. */ }
            else if (event.event === 'turn.start') {
              if (!sameSession) this.receive(id, { version: 1, provider: event.provider, event: 'session.start', sessionId: event.sessionId });
              this.active.set(id, event);
            } else if (!sameSession || (event.turnId && current?.turnId !== event.turnId)) {
              activityDiagnostic('bridge.stale', event, { sameSession, sameTurn: current?.turnId === event.turnId });
              res.writeHead(204).end(); return;
            } else if (event.provider === 'claude' && current?.ended && event.event.startsWith('attention.')) {
              // Another Stop hook can continue a Claude turn after its first Stop; reopen it.
              this.active.set(id, { ...current, ended: false });
              this.forward(id, { version: 1, provider: event.provider, event: 'turn.start', sessionId: event.sessionId, turnId: event.turnId });
            }
            if (event.event === 'session.end') this.active.delete(id);
            if (event.event === 'turn.end' && current) this.active.set(id, { ...this.active.get(id)!, ended: true });
            activityDiagnostic('bridge.accepted', event);
            this.forward(id, event);
            res.writeHead(204).end();
          } catch { res.writeHead(400).end(); }
        });
      });
      server.requestTimeout = 2000;
      server.headersTimeout = 2000;
      server.maxConnections = 64;
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => { server.unref(); resolve((server.address() as { port: number }).port); });
    });
  }
}

/** Placeholder session for setup health reported before the agent's first hook. */
export function setupSessionId(provider: string): string { return `janet-${provider}-setup`; }

export function codexActivity(value: unknown): AgentLifecycleEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(key => !['event', 'sessionId', 'turnId'].includes(key))) return null;
  const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
  if (!id(p.sessionId) || typeof p.event !== 'string') return null;
  const events: Record<string, AgentLifecycleEvent['event']> = {
    SessionStart: 'session.start', SessionEnd: 'session.end', UserPromptSubmit: 'turn.start',
    PreToolUse: 'attention.resolve', PostToolUse: 'attention.resolve', PermissionRequest: 'attention.request',
    Interrupt: 'turn.end', 'agent-turn-complete': 'turn.end',
  };
  const event = Object.hasOwn(events, p.event) ? events[p.event] : undefined;
  if (!event || (!event.startsWith('session.') && !id(p.turnId))) return null;
  return { version: 1, provider: 'codex', event, sessionId: p.sessionId,
    ...(!event.startsWith('session.') ? { turnId: p.turnId as string } : {}),
    ...(event === 'turn.end' ? { outcome: p.event === 'Interrupt' ? 'interrupted' as const : 'succeeded' as const } : {}),
  };
}

