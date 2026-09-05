import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { AgentLifecycleEvent } from '../renderer/terminalAwareness';

/** Opt-in, bounded metadata only: never prompts, output, paths or capability URLs. */
export function activityDiagnostic(stage: string, event?: AgentLifecycleEvent | null,
  detail?: { connected?: boolean; child?: boolean; status?: number; sameSession?: boolean; sameTurn?: boolean }): void {
  const target = process.env.JANET_ACTIVITY_DIAGNOSTICS;
  if (!target) return;
  try {
    try { const stat = fs.lstatSync(target); if (!stat.isFile() || stat.isSymbolicLink() || stat.size >= 65536) return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return; }
    const hash = (id: string | undefined) => id ? createHash('sha256').update(id).digest('hex').slice(0, 16) : undefined;
    fs.appendFileSync(target, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, stage,
      event: event?.event, session: hash(event?.sessionId), turn: hash(event?.turnId), ...detail }) + '\n', { mode: 0o600 });
  } catch { /* Diagnostics must never affect terminal operation. */ }
}
