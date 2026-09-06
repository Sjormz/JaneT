// @vitest-environment node
import { it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { activityDiagnostic } from '../../src/main/activityDiagnostics';

it('logs only bounded opt-in metadata, never raw event content or identifiers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-diagnostics-'));
  const target = path.join(directory, 'events.jsonl');
  const previous = process.env.JANET_ACTIVITY_DIAGNOSTICS;
  try {
    delete process.env.JANET_ACTIVITY_DIAGNOSTICS;
    activityDiagnostic('disabled');
    expect(fs.existsSync(target)).toBe(false);
    process.env.JANET_ACTIVITY_DIAGNOSTICS = target;
    const event = { version: 1 as const, provider: 'codex', event: 'turn.end' as const,
      sessionId: 'private-session', turnId: 'private-turn', prompt: 'PRIVATE PROMPT', output: 'PRIVATE OUTPUT' };
    activityDiagnostic('bridge.accepted', event, { status: 204 });
    const text = fs.readFileSync(target, 'utf8');
    expect(text).not.toMatch(/private|PRIVATE/);
    expect(JSON.parse(text)).toMatchObject({ event: 'turn.end', stage: 'bridge.accepted', status: 204 });
    expect(JSON.parse(text).session).toMatch(/^[a-f0-9]{16}$/);
    fs.writeFileSync(target, 'x'.repeat(65536));
    activityDiagnostic('over-limit');
    expect(fs.statSync(target).size).toBe(65536);
    process.env.JANET_ACTIVITY_DIAGNOSTICS = directory;
    expect(() => activityDiagnostic('not-file')).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env.JANET_ACTIVITY_DIAGNOSTICS;
    else process.env.JANET_ACTIVITY_DIAGNOSTICS = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
