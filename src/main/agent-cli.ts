// Bundled separately, copied to a stable app-data path and run by the user's Node.
// No Electron dependency and no access to JaneT's renderer or user transcripts.
import * as http from 'node:http';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import { removeCodexActivity } from './codexActivitySetup';
import { codexLaunch, type CodexLaunch } from './codexSession';
import { installHermesActivity, mapHermesActivity, removeHermesActivity } from './hermesActivitySetup';
import { codexActivity } from './agentActivityBridge';
import { decodeNotify, notifyCommand } from './codexNotify';
import { claudeActivity, claudeLaunchDecision, claudeSettingsPath } from './claudeActivity';
import { activityDiagnostic } from './activityDiagnostics';
import * as fs from 'node:fs';
import type { AgentLifecycleEvent } from '../renderer/terminalAwareness';

const [mode, ...args] = process.argv.slice(2);
const endpoint = process.env.JANET_ACTIVITY_URL;
const connected = /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}$/.test(endpoint ?? '');
activityDiagnostic('helper.start', undefined, { connected });

function send(event: AgentLifecycleEvent | { provider: 'codex' | 'claude'; event: 'integration.status'; available: boolean } | null): void {
  if (!connected || !event) return;
  const request = http.request(endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' } }, response => {
    activityDiagnostic('helper.response', 'version' in event ? event : undefined, { status: response.statusCode });
    response.resume();
  });
  request.setTimeout(800, () => request.destroy());
  request.on('error', () => activityDiagnostic('helper.delivery-error'));
  request.end(JSON.stringify(event));
}

function setupError(error: unknown, message: string): void {
  const { code, syscall } = (error ?? {}) as NodeJS.ErrnoException;
  activityDiagnostic('helper.setup-error', undefined, {
    errorCode: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? code : undefined,
    syscall: typeof syscall === 'string' && /^[a-zA-Z]{1,32}$/.test(syscall) ? syscall : undefined,
  });
  process.stderr.write(`[JaneT activity] ${message}\n`);
}

function hook(input: string): void {
  try {
    const payload = JSON.parse(input);
    if (mode === '--hermes-hook') send(mapHermesActivity(payload));
    else if (mode === '--claude-hook') send(claudeActivity(payload));
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

if (mode === '--codex-notify-forward' || mode === '--codex-notify-forward-b64') {
  // Codex appends the original JSON as one argument. Relay it unchanged, even outside JaneT.
  // Never run through a shell: notification text and configured arguments are not shell code.
  hook(args[1] ?? '');
  try {
    const command = notifyCommand(mode === '--codex-notify-forward-b64' ? decodeNotify(args[0]) : JSON.parse(args[0] ?? ''));
    if (command.length && process.env.JANET_NOTIFY_FORWARDING !== '1') {
      const child = spawn(command[0], [...command.slice(1), args[1] ?? ''], {
        windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, JANET_NOTIFY_FORWARDING: '1' },
      });
      child.on('error', () => { process.stderr.write('[JaneT activity] Existing Codex notification handler could not start.\n'); process.exitCode = 1; });
      child.on('exit', code => { process.exitCode = code ?? 1; });
    }
  } catch { process.stderr.write('[JaneT activity] Invalid forwarded notification command.\n'); process.exitCode = 1; }
} else if (mode === '--setup-codex') {
  // Prints one session `-c` value per line and exits 0; any other outcome launches Codex unchanged.
  process.exitCode = 1;
  if (connected) {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    let launch: CodexLaunch = { decision: 'skip' };
    try { launch = codexLaunch(args, __filename, codexHome); }
    catch (error) { setupError(error, 'Codex activity is unavailable for this launch; Codex will start normally.'); send({ provider: 'codex', event: 'integration.status', available: false }); }
    if (launch.decision !== 'skip') {
      try {
        // Session hooks replace the persistent entries older JaneT builds wrote; remove those once.
        const cleanup = removeCodexActivity(codexHome);
        if (cleanup.message) process.stderr.write(`[JaneT activity] ${cleanup.message}\n`);
        if (cleanup.changed.length) process.stderr.write('[JaneT activity] Removed entries an older JaneT added to your Codex configuration; backups end in .janet-backup-*.\n');
      } catch (error) { setupError(error, 'Old JaneT entries in your Codex configuration could not be removed safely; remove them manually.'); }
      if (launch.decision === 'conflict') process.stderr.write('[JaneT activity] Explicit notify override detected; completion tracking is incomplete for this launch.\n');
      send({ provider: 'codex', event: 'integration.status', available: launch.decision === 'inject' });
      process.stdout.write(launch.config.join('\n') + '\n');
      process.exitCode = 0;
    }
  }
} else if (mode === '--uninstall') {
  // Removes every persistent JaneT entry from agent configuration. Claude and Codex launches are session-only.
  const results: string[] = [];
  let failed = false;
  try {
    const codex = removeCodexActivity(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
    if (codex.message) { failed = true; results.push(`Codex: ${codex.message}`); }
    else results.push(codex.changed.length ? `Codex: removed JaneT entries from ${codex.changed.length} file(s).` : 'Codex: nothing to remove.');
  } catch (error) { failed = true; results.push(`Codex: could not update safely (${error instanceof Error ? error.message : 'unknown error'}).`); }
  try {
    const hermes = removeHermesActivity(process.env);
    results.push(hermes.length ? `Hermes: removed JaneT hooks from ${hermes.length} file(s).` : 'Hermes: nothing to remove.');
  } catch (error) { failed = true; results.push(`Hermes: could not update safely (${error instanceof Error ? error.message : 'unknown error'}).`); }
  process.stdout.write(results.join('\n') + '\n');
  process.exitCode = failed ? 1 : 0;
} else if (connected && mode === '--setup-hermes') {
  try {
    // Help/version invocations should remain completely read-only.
    if (!args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) {
      const result = installHermesActivity(__filename, args, process.env);
      if (result.message) process.stderr.write(`[JaneT activity] ${result.message}\n`);
    }
  } catch (error) { setupError(error, 'Automatic setup could not safely update this configuration. The CLI will still start normally.'); }
} else if (mode === '--setup-claude') {
  // Exit status tells the shell wrapper whether to add `--settings`; any failure launches Claude unchanged.
  const decision = claudeLaunchDecision(args);
  let ready = false;
  try { ready = connected && fs.statSync(claudeSettingsPath(__filename)).isFile(); } catch { /* Launch unchanged. */ }
  if (ready && decision !== 'skip') {
    if (decision === 'conflict') process.stderr.write('[JaneT activity] Explicit --settings detected; activity tracking is off for this launch.\n');
    send({ provider: 'claude', event: 'integration.status', available: decision === 'inject' });
  }
  process.exitCode = ready && decision === 'inject' ? 0 : 1;
} else if (connected && ['--codex-hook', '--codex-notify', '--hermes-hook', '--claude-hook'].includes(mode)) {
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
