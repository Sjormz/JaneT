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
  private active = new Map<string, { provider: string; sessionId: string; turnId?: string }>();
  private completionTracking = new Map<string, boolean>();
  constructor(private readonly receive: (id: string, event: AgentLifecycleEvent) => void) {}

  async environment(id: string): Promise<Record<string, string>> {
    if (typeof id !== 'string' || !id || id.length > 256) throw new Error('Invalid terminal identity');
    if (!this.terminals.has(id) && this.terminals.size >= 64) throw new Error('Activity terminal limit reached');
    const token = this.terminals.get(id) ?? randomBytes(32).toString('hex');
    this.terminals.set(id, token);
    const port = await (this.opening ??= this.open());
    return { JANET_ACTIVITY_URL: `http://127.0.0.1:${port}/${token}` };
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
            if (provider === 'codex' && data.event === 'integration.status') {
              if (Object.keys(data).length !== 2 || typeof data.available !== 'boolean' || req.url !== `/${this.terminals.get(id)}`) { res.writeHead(400).end(); return; }
              this.completionTracking.set(id, data.available);
              this.receive(id, { version: 1, provider, event: 'integration.status', sessionId: this.active.get(id)?.sessionId ?? 'janet-codex-setup', completionTracking: data.available });
              res.writeHead(204).end(); return;
            }
            const event = provider === undefined ? codexActivity(payload)
              : ['codex', 'hermes'].includes(provider) ? validateAgentEvent(provider, data) : undefined;
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
            }
            if (event.event === 'session.end') this.active.delete(id);
            activityDiagnostic('bridge.accepted', event);
            this.receive(id, event.provider === 'codex' && this.completionTracking.has(id)
              ? { ...event, completionTracking: this.completionTracking.get(id) } : event);
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

// Hooks receive sensitive inputs; only the allowlisted event identifiers leave this process.
export const CODEX_ACTIVITY_SCRIPT = String.raw`const http = require('node:http');
const endpoint = process.env.JANET_ACTIVITY_URL;
let finished = false;
function finish() { if (!finished) { finished = true; process.stdout.write('{}'); } }
function send(input) {
  try {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/.test(endpoint || '')) return finish();
    const p = JSON.parse(input);
    if (p.agent_id) return finish();
    const event = p.type || p.hook_event_name;
    const body = JSON.stringify({event, sessionId: p['thread-id'] || p.session_id, turnId: p['turn-id'] || p.turn_id});
    const req = http.request(endpoint, {method:'POST', headers:{'content-type':'application/json'}}, res => {res.resume(); res.on('end', finish);});
    req.setTimeout(800, () => req.destroy()); req.on('error', finish); req.end(body);
  } catch { finish(); }
}
if (process.argv[2]) send(process.argv[2]);
else { let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { input+=chunk; if(input.length>1048576) process.exit(0); }); process.stdin.on('end',()=>send(input)); }
`;
