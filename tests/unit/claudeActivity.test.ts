// @vitest-environment node
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { buildSync } from 'esbuild';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentActivityBridge } from '../../src/main/agentActivityBridge';
import { claudeActivity, claudeLaunchDecision, claudeSettings, claudeSettingsPath } from '../../src/main/claudeActivity';
import { buildShellInit } from '../../src/main/shell-init';
import { applyAgentEvent, agentStatus, type AgentAwareness } from '../../src/renderer/terminalAwareness';

function run(executable: string, args: string[], env: NodeJS.ProcessEnv, input = '', closeInput = true): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Child timed out')); }, 12000);
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
    child.stdin.on('error', () => {});
    if (closeInput) child.stdin.end(input); else child.stdin.write(input);
  });
}

const hook = (event: string, extra: Record<string, unknown> = {}) =>
  ({ hook_event_name: event, session_id: 'session', prompt_id: 'prompt-1', transcript_path: '/private/transcript.jsonl', cwd: '/private', ...extra });

// Bundle once: esbuild uses every core, and repeated bundles starve concurrent test files.
let bundleDirectory: string;
let bundle: string;
beforeAll(() => {
  bundleDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-claude-bundle-'));
  bundle = path.join(bundleDirectory, 'agent-cli.cjs');
  buildSync({ entryPoints: ['src/main/agent-cli.ts'], bundle: true, platform: 'node', outfile: bundle });
});
afterAll(() => { if (bundleDirectory) fs.rmSync(bundleDirectory, { recursive: true, force: true }); });

describe('Claude Code activity', () => {
  it('maps documented hooks to lifecycle identifiers only', () => {
    expect(claudeActivity(hook('SessionStart', { source: 'startup' }))).toEqual({ version: 1, provider: 'claude', event: 'session.start', sessionId: 'session' });
    expect(claudeActivity(hook('UserPromptSubmit', { user_input: 'secret' }))).toEqual({ version: 1, provider: 'claude', event: 'turn.start', sessionId: 'session', turnId: 'prompt-1' });
    expect(claudeActivity(hook('PreToolUse', { tool_input: { command: 'secret' } }))).toMatchObject({ event: 'attention.resolve' });
    expect(claudeActivity(hook('PostToolUseFailure'))).toMatchObject({ event: 'attention.resolve' });
    expect(claudeActivity(hook('PermissionRequest'))).toMatchObject({ event: 'attention.request', turnId: 'prompt-1' });
    expect(claudeActivity(hook('Notification', { notification_type: 'permission_prompt' }))).toMatchObject({ event: 'attention.request' });
    expect(claudeActivity(hook('Notification', { notification_type: 'idle_prompt' }))).toBeNull();
    expect(claudeActivity(hook('Stop', { last_assistant_message: 'secret' }))).toMatchObject({ event: 'turn.end', outcome: 'succeeded' });
    expect(claudeActivity(hook('Stop', { stop_reason: 'user_stop' }))).toMatchObject({ outcome: 'interrupted' });
    expect(claudeActivity(hook('StopFailure', { error_type: 'rate_limit' }))).toMatchObject({ event: 'turn.end', outcome: 'failed' });
    expect(claudeActivity(hook('SessionEnd', { reason: 'prompt_input_exit' }))).toEqual({ version: 1, provider: 'claude', event: 'session.end', sessionId: 'session' });
    expect(JSON.stringify(claudeActivity(hook('UserPromptSubmit', { user_input: 'secret' })))).not.toContain('secret');
  });

  it('ignores subagents, unknown events and turn hooks without a prompt id', () => {
    expect(claudeActivity(hook('Stop', { agent_id: 'child' }))).toBeNull();
    expect(claudeActivity(hook('constructor'))).toBeNull();
    expect(claudeActivity(hook('PreToolUse', { prompt_id: undefined }))).toBeNull();
    expect(claudeActivity(hook('SessionStart', { prompt_id: undefined }))).toMatchObject({ event: 'session.start' });
    expect(claudeActivity(hook('SessionStart', { session_id: '\0' }))).toBeNull();
    expect(claudeActivity([])).toBeNull();
  });

  it('adds hooks only to interactive and print sessions without overriding user settings', () => {
    expect(claudeLaunchDecision([])).toBe('inject');
    expect(claudeLaunchDecision(['--resume', 'abc', '-p', 'hello'])).toBe('inject');
    expect(claudeLaunchDecision(['mcp', 'list'])).toBe('skip');
    expect(claudeLaunchDecision(['--version'])).toBe('skip');
    expect(claudeLaunchDecision(['--bg', 'task'])).toBe('skip');
    expect(claudeLaunchDecision(['--settings', 'mine.json'])).toBe('conflict');
    expect(claudeLaunchDecision(['--settings={}'])).toBe('conflict');
  });

  it('writes exec-form hooks that need no shell quoting', () => {
    const helper = path.join(os.tmpdir(), "it's $(odd)", 'agent-cli.cjs');
    const settings = JSON.parse(claudeSettings(helper));
    expect(Object.keys(settings)).toEqual(['hooks']);
    for (const name of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'StopFailure', 'SessionEnd']) {
      expect(settings.hooks[name]).toEqual([{ hooks: [{ type: 'command', command: 'node', args: [helper, '--claude-hook'], timeout: 2 }] }]);
    }
    expect(claudeSettingsPath(helper)).toBe(path.join(path.dirname(helper), 'claude-settings.json'));
  });

  it('reports setup health and reopens a turn continued after Stop', async () => {
    const events: any[] = [];
    const bridge = new AgentActivityBridge((_id, event) => events.push(event));
    try {
      const env = await bridge.environment('one');
      const post = (value: unknown) => fetch(env.JANET_ACTIVITY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      const base = { version: 1, provider: 'claude', sessionId: 'session' };
      await post({ provider: 'claude', event: 'integration.status', available: true });
      expect(events.at(-1)).toMatchObject({ provider: 'claude', sessionId: 'janet-claude-setup', completionTracking: true });
      await post({ ...base, event: 'session.start' });
      await post({ ...base, event: 'turn.start', turnId: 't1' });
      await post({ ...base, event: 'turn.end', turnId: 't1', outcome: 'succeeded' });
      await post({ ...base, event: 'attention.resolve', turnId: 't1' });
      await post({ ...base, event: 'turn.end', turnId: 't1', outcome: 'succeeded' });
      await post({ ...base, event: 'attention.resolve', turnId: 'stale' });
      expect(events.slice(1).map(event => event.event)).toEqual(['session.start', 'turn.start', 'turn.end', 'turn.start', 'attention.resolve', 'turn.end']);
      expect(events.slice(1).every(event => event.completionTracking === true)).toBe(true);
      // Codex setup health never relabels another provider's events.
      await post({ provider: 'codex', event: 'integration.status', available: false });
      await post({ ...base, event: 'turn.start', turnId: 't2' });
      expect(events.at(-1)).not.toHaveProperty('completionTracking');
    } finally { bridge.close(); }
  });

  it('routes the real bundled helper from setup through a finished turn', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-claude-runtime-'));
    const helper = path.join(directory, 'agent cli.cjs');
    let awareness: AgentAwareness | undefined;
    const events: any[] = [];
    const bridge = new AgentActivityBridge((_id, event) => { events.push(event); awareness = applyAgentEvent(awareness, event, Date.now(), false); });
    try {
      fs.copyFileSync(bundle, helper);
      const env = { ...process.env, ...await bridge.environment('terminal') };
      // Without the settings file the wrapper must launch Claude unchanged.
      expect((await run(process.execPath, [helper, '--setup-claude'], env)).code).toBe(1);
      fs.writeFileSync(claudeSettingsPath(helper), claudeSettings(helper));
      expect((await run(process.execPath, [helper, '--setup-claude', '--version'], env)).code).toBe(1);
      expect(events).toEqual([]);
      expect((await run(process.execPath, [helper, '--setup-claude', '--model', 'x'], env)).code).toBe(0);
      expect(agentStatus(awareness!).label).toBe('Claude · Awaiting activity');
      // Real input framing: one JSON object, stdin deliberately left open.
      expect((await run(process.execPath, [helper, '--claude-hook'], env, JSON.stringify(hook('SessionStart')), false)).output).toBe('{}');
      await run(process.execPath, [helper, '--claude-hook'], env, JSON.stringify(hook('UserPromptSubmit', { user_input: 'secret' })), false);
      expect(agentStatus(awareness!).label).toBe('Claude · Running');
      await run(process.execPath, [helper, '--claude-hook'], env, JSON.stringify(hook('PermissionRequest', { tool_input: { command: 'secret' } })));
      expect(agentStatus(awareness!).label).toBe('Claude · Needs input');
      await run(process.execPath, [helper, '--claude-hook'], env, JSON.stringify(hook('Stop', { last_assistant_message: 'secret' })));
      expect(agentStatus(awareness!).label).toBe('Claude · Turn finished');
      expect(JSON.stringify(events)).not.toContain('secret');
      const conflict = await run(process.execPath, [helper, '--setup-claude', '--settings', 'mine.json'], env);
      expect(conflict.code).toBe(1);
      expect(conflict.output).toContain('Explicit --settings');
      expect(agentStatus(awareness!).label).toBe('Claude · Activity tracking incomplete');
      const outside: NodeJS.ProcessEnv = { ...env }; delete outside.JANET_ACTIVITY_URL;
      expect((await run(process.execPath, [helper, '--setup-claude'], outside)).code).toBe(1);
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it.each(['bash', 'zsh', 'fish', 'powershell.exe'])('wraps claude in %s only when activity is available', (shell) => {
    expect(buildShellInit(shell)).not.toContain('--setup-claude');
    const init = buildShellInit(shell, '/tmp/agent-helper.cjs');
    expect(init).toContain('--setup-claude');
    expect(init).toContain(claudeSettingsPath('/tmp/agent-helper.cjs').replace(/\\/g, shell === 'fish' ? '\\\\' : '\\'));
  });

  it.skipIf(process.platform === 'win32')('Bash claude launches add session settings only when the helper approves', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "janet claude's "));
    const bridge = new AgentActivityBridge(() => {});
    try {
      const helper = path.join(directory, 'helper.cjs');
      fs.copyFileSync(bundle, helper);
      fs.writeFileSync(claudeSettingsPath(helper), claudeSettings(helper));
      const fake = path.join(directory, 'claude');
      fs.writeFileSync(fake, '#!/bin/sh\nfor arg in "$@"; do printf "ARG=%s\\n" "$arg"; done\nexit 37\n', { mode: 0o755 });
      const env = { ...process.env, ...await bridge.environment('bash'), PATH: directory + path.delimiter + process.env.PATH };
      const launch = async (line: string) => (await run('/bin/bash', ['-c', `${buildShellInit('bash', helper)}\n${line}\necho "EXIT=$?"`], env)).output;
      // Shell-integration OSC markers may surround the output; assert on the argument lines.
      const interactive = await launch("claude 'a b'");
      expect(interactive).toContain(`ARG=--settings\nARG=${claudeSettingsPath(helper)}\nARG=a b\n`);
      expect(interactive).toContain('EXIT=37');
      const version = await launch('claude --version');
      expect(version).toContain('ARG=--version\n');
      expect(version).not.toContain('--settings');
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 30000);

  it.skipIf(process.platform !== 'win32')('PowerShell claude launches add session settings and keep arguments, input and exit codes', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "janet claude's "));
    const bridge = new AgentActivityBridge(() => {});
    try {
      const helper = path.join(directory, 'helper.cjs');
      fs.copyFileSync(bundle, helper);
      fs.writeFileSync(claudeSettingsPath(helper), claudeSettings(helper));
      fs.writeFileSync(path.join(directory, 'claude.ps1'), '[Console]::WriteLine("ARGS=" + ($args | ConvertTo-Json -Compress)); $input | ForEach-Object { [Console]::WriteLine("INPUT=$_") }; $global:LASTEXITCODE = 37');
      fs.writeFileSync(path.join(directory, 'node.ps1'), 'throw "The Node script shim must not run."');
      const script = path.join(directory, 'test.ps1');
      const env = { ...process.env, ...await bridge.environment('ps'), PATH: directory + path.delimiter + process.env.PATH };
      const launch = async (line: string) => {
        fs.writeFileSync(script, `${buildShellInit('powershell.exe', helper)}\n${line}\n[Console]::WriteLine("EXIT=$LASTEXITCODE")\n`);
        return (await run('powershell.exe', ['-NoProfile', '-File', script], env)).output;
      };
      // ConvertTo-Json escapes the apostrophe in the deliberately awkward directory name.
      const settings = JSON.stringify(claudeSettingsPath(helper)).replace(/'/g, '\\u0027');
      const interactive = await launch(`claude 'a b' --resume`);
      expect(interactive).toContain(`ARGS=["--settings",${settings},"a b","--resume"]`);
      expect(interactive).toContain('EXIT=37');
      expect(await launch('claude')).toContain(`ARGS=["--settings",${settings}]`);
      expect(await launch('claude --version')).toContain('ARGS="--version"');
      expect(await launch('claude --settings mine.json')).toContain('ARGS=["--settings","mine.json"]');
      expect(await launch(`'prompt from pipe' | claude -p`)).toContain('INPUT=prompt from pipe');
      expect(await launch(`function MyClaude { 'kept-alias' }; Set-Alias claude MyClaude\n${buildShellInit('powershell.exe', helper)}\nclaude`)).toContain('kept-alias');
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 60000);
});
