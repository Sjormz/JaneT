// Bundled separately, copied to a stable app-data path and run by the user's Node.
// No Electron dependency and no access to JaneT's renderer or user transcripts.
import * as http from 'node:http';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { installCodexActivity } from './codexActivitySetup';
import { installHermesActivity, mapHermesActivity } from './hermesActivitySetup';
import { codexActivity } from './agentActivityBridge';
import { notifyCommand } from './codexNotify';
import { activityDiagnostic } from './activityDiagnostics';
import type { AgentLifecycleEvent } from '../renderer/terminalAwareness';

const [mode, ...args] = process.argv.slice(2);
const endpoint = process.env.JANET_ACTIVITY_URL;
const connected = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/.test(endpoint ?? '');
activityDiagnostic('helper.start', undefined, { connected });

function send(event: AgentLifecycleEvent | { provider: 'codex'; event: 'integration.status'; available: boolean } | null): void {
  if (!connected || !event) return;
  const request = http.request(endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
    activityDiagnostic('helper.response', 'version' in event ? event : undefined, { status: response.statusCode });
    response.resume();
  });
  request.setTimeout(800, () => request.destroy());
  request.on('error', () => activityDiagnostic('helper.delivery-error'));
  request.end(JSON.stringify(event));
}

function hook(input: string): void {
  try {
    const payload = JSON.parse(input);
    if (mode === '--hermes-hook') send(mapHermesActivity(payload));
    else if (payload) {
      const event = codexActivity({
      event: payload.type || payload.hook_event_name,
      sessionId: payload['thread-id'] || payload.session_id,
      turnId: payload['turn-id'] || payload.turn_id,
      });
      activityDiagnostic('helper.codex-input', event, { child: Boolean(payload.agent_id) });
      if (!payload.agent_id) send(event);
    }
  } catch { activityDiagnostic('helper.invalid-input'); }
  process.stdout.write('{}');
}

if (mode === '--codex-notify-forward') {
  // Codex appends the original JSON as one argument. Relay it unchanged, even outside JaneT.
  // Never run through a shell: notification text and configured arguments are not shell code.
  hook(args[1] ?? '');
  try {
    const command = notifyCommand(JSON.parse(args[0] ?? ''));
    if (command.length && process.env.JANET_NOTIFY_FORWARDING !== '1') {
      const child = spawn(command[0], [...command.slice(1), args[1] ?? ''], {
        windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, JANET_NOTIFY_FORWARDING: '1' },
      });
      child.on('error', () => { process.stderr.write('[JaneT activity] Existing Codex notification handler could not start.\n'); process.exitCode = 1; });
      child.on('exit', code => { process.exitCode = code ?? 1; });
    }
  } catch { process.stderr.write('[JaneT activity] Invalid forwarded notification command.\n'); process.exitCode = 1; }
} else if (connected && (mode === '--setup-codex' || mode === '--setup-hermes')) {
  try {
    // Help/version invocations should remain completely read-only.
    if (!args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) {
      const result = mode === '--setup-codex'
        ? installCodexActivity(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), __filename)
        : installHermesActivity(__filename, args, process.env);
      if (result.message) process.stderr.write(`[JaneT activity] ${result.message}\n`);
      if (mode === '--setup-codex') {
        const override = args.some((arg, index) => /^(?:-c=?|--config=)notify\s*=/.test(arg) ||
          (['-c', '--config'].includes(args[index - 1]) && /^notify\s*=/.test(arg)));
        if (override) process.stderr.write('[JaneT activity] Explicit notify override detected; completion tracking is incomplete for this launch.\n');
        send({ provider: 'codex', event: 'integration.status', available: !result.message && !override });
      }
    }
  } catch {
    process.stderr.write('[JaneT activity] Automatic setup could not safely update this configuration. The CLI will still start normally.\n');
    if (mode === '--setup-codex') send({ provider: 'codex', event: 'integration.status', available: false });
  }
} else if (connected && ['--codex-hook', '--codex-notify', '--hermes-hook'].includes(mode)) {
  if (mode === '--codex-notify') hook(args[0] ?? '');
  else {
    let input = '', finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.stdin.pause();
      process.stdin.destroy();
      hook(input);
    };
    const timer = setTimeout(() => {
      process.stderr.write('[JaneT activity] Hook input was incomplete; activity could not be updated.\n');
      finish();
    }, 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (finished) return;
      input += chunk;
      if (input.length > 1048576) { input = ''; finish(); return; }
      // Hooks send one JSON object. A complete object need not wait for the parent to close stdin.
      try { JSON.parse(input); } catch { return; }
      finish();
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  }
}
