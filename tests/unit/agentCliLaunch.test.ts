// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSync } from 'esbuild';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentActivityBridge } from '../../src/main/agentActivityBridge';
import { buildShellInit } from '../../src/main/shell-init';
import { parse } from 'smol-toml';
import { applyAgentEvent, agentStatus, type AgentAwareness } from '../../src/renderer/terminalAwareness';

function run(executable: string, args: string[], env: NodeJS.ProcessEnv, input = '', closeInput = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Child timed out')); }, 12000);
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`Exit ${code}: ${output}`)); });
    child.stdin.on('error', () => {});
    if (closeInput) child.stdin.end(input); else child.stdin.write(input);
  });
}

describe('automatic agent launch runtime', () => {
  it('returns to Ready through the configured notifier while preserving the existing handler inside and outside JaneT', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-codex-forward-'));
    const helper = path.join(directory, 'agent-cli.cjs');
    const outputPath = path.join(directory, 'forwarded.json');
    const originalScript = path.join(directory, 'original.cjs');
    let awareness: AgentAwareness | undefined;
    const bridge = new AgentActivityBridge((_id, event) => { awareness = applyAgentEvent(awareness, event, Date.now(), true); });
    try {
      buildSync({ entryPoints: ['src/main/agent-cli.ts'], bundle: true, platform: 'node', outfile: helper });
      fs.writeFileSync(originalScript, `require('fs').writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(process.argv.slice(2)));`);
      const original = [process.execPath, originalScript, 'a b', 'quote"$;&value'];
      const codexHome = path.join(directory, 'codex'); fs.mkdirSync(codexHome);
      fs.writeFileSync(path.join(codexHome, 'config.toml'), 'notify = ' + JSON.stringify(original));
      const env = { ...process.env, ...await bridge.environment('terminal'), CODEX_HOME: codexHome };
      await run(process.execPath, [helper, '--setup-codex'], env);
      const configured = parse(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')).notify as string[];
      // Real input framing regression: valid JSON, with stdin deliberately left open.
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'one' }), false);
      expect(agentStatus(awareness!).kind).toBe('running');
      const payload = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'codex', 'turn-id': 'one', 'last-assistant-message': 'private\n"$; & text' });
      await run(configured[0], [...configured.slice(1), payload], env);
      expect(agentStatus(awareness!).label).toBe('Codex · Ready');
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual([...original.slice(2), payload]);
      const outside: NodeJS.ProcessEnv = { ...env }; delete outside.JANET_ACTIVITY_URL;
      await run(configured[0], [...configured.slice(1), payload], outside);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual([...original.slice(2), payload]);
      // A failing original notifier cannot suppress JaneT's completion delivery.
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'one' }));
      fs.writeFileSync(originalScript, 'process.exit(7);');
      await expect(run(configured[0], [...configured.slice(1), payload], env)).rejects.toThrow('Exit 7');
      expect(agentStatus(awareness!).label).toBe('Codex · Ready');
      await run(process.execPath, [helper, '--setup-codex', '-c', 'notify=["explicit"]'], env);
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'two' }));
      expect(agentStatus(awareness!).label).toBe('Codex · Activity tracking incomplete');
      await run(process.execPath, [helper, '--setup-codex'], env);
      expect(agentStatus(awareness!).kind).toBe('running');
      fs.writeFileSync(path.join(codexHome, '.janet-activity.lock'), 'occupied');
      expect(await run(process.execPath, [helper, '--setup-codex'], env)).toContain('already running');
      expect(agentStatus(awareness!).kind).toBe('unavailable');
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);
  it('sets up once and routes real bundled Codex and Hermes helpers without private payload fields', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-cli-runtime-'));
    const helper = path.join(directory, 'agent helper.cjs');
    const events: any[] = [];
    const bridge = new AgentActivityBridge((id, event) => events.push({ id, ...event }));
    try {
      buildSync({ entryPoints: ['src/main/agent-cli.ts'], bundle: true, platform: 'node', outfile: helper });
      const env = { ...process.env, ...await bridge.environment('terminal'), CODEX_HOME: path.join(directory, 'codex') };
      await run(process.execPath, [helper, '--setup-codex', '--help'], env);
      expect(fs.existsSync(env.CODEX_HOME)).toBe(false);
      await run(process.execPath, [helper, '--setup-codex'], env);
      const config = fs.readFileSync(path.join(env.CODEX_HOME, 'config.toml'), 'utf8');
      await run(process.execPath, [helper, '--setup-codex'], env);
      expect(fs.readFileSync(path.join(env.CODEX_HOME, 'config.toml'), 'utf8')).toBe(config);
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'one', prompt: 'secret' }));
      await run(process.execPath, [helper, '--codex-notify', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'codex', 'turn-id': 'one', 'last-assistant-message': 'secret' })], env);
      await run(process.execPath, [helper, '--hermes-hook'], env, JSON.stringify({ hook_event_name: 'pre_llm_call', session_id: 'hermes', extra: { turn_id: 'two', platform: 'tui', user_message: 'secret' } }));
      await run(process.execPath, [helper, '--hermes-hook'], env, JSON.stringify({ hook_event_name: 'on_session_end', session_id: 'child', extra: { turn_id: 'child', completed: true, failed: false, interrupted: false } }));
      await run(process.execPath, [helper, '--hermes-hook'], env, JSON.stringify({ hook_event_name: 'on_session_end', session_id: 'hermes', extra: { turn_id: 'two', completed: true, failed: false, interrupted: false } }));
      expect(events.map(event => event.event)).toEqual(['integration.status', 'integration.status', 'session.start', 'turn.start', 'turn.end', 'session.start', 'turn.start', 'turn.end']);
      expect(JSON.stringify(events)).not.toContain('secret');
      expect(events.at(-1)).toMatchObject({ provider: 'hermes', outcome: 'succeeded', id: 'terminal' });
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it.skipIf(process.platform !== 'win32')('ordinary PowerShell codex invocation installs before launch and preserves arguments and exit status', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "janet launch's "));
    const bridge = new AgentActivityBridge(() => {});
    try {
      const helper = path.join(directory, 'helper.cjs');
      buildSync({ entryPoints: ['src/main/agent-cli.ts'], bundle: true, platform: 'node', outfile: helper });
      fs.writeFileSync(path.join(directory, 'codex.ps1'), '[Console]::WriteLine(($args | ConvertTo-Json -Compress)); $global:LASTEXITCODE = 37');
      const script = path.join(directory, 'test.ps1');
      fs.writeFileSync(script, `${buildShellInit('powershell.exe', helper)}\ncodex 'a b' 'quote"value' --resume\n[Console]::WriteLine("EXIT=$LASTEXITCODE")\n`);
      const env = { ...process.env, ...await bridge.environment('ps'), CODEX_HOME: path.join(directory, 'codex-home'), PATH: directory + path.delimiter + process.env.PATH };
      const output = await run('powershell.exe', ['-NoProfile', '-File', script], env);
      expect(output).toContain('["a b","quote\\"value","--resume"]');
      expect(output).toContain('EXIT=37');
      expect(fs.existsSync(path.join(env.CODEX_HOME, 'hooks.json'))).toBe(true);
      fs.writeFileSync(path.join(directory, 'codex.ps1'), '$input | ForEach-Object { [Console]::WriteLine("INPUT=$_") }');
      fs.writeFileSync(script, `${buildShellInit('powershell.exe', helper)}\n'prompt from pipe' | codex -\n`);
      expect(await run('powershell.exe', ['-NoProfile', '-File', script], env)).toContain('INPUT=prompt from pipe');
      // User aliases remain untouched instead of being replaced by JaneT's wrapper.
      fs.writeFileSync(script, `function MyCodex { 'kept-alias' }; Set-Alias codex MyCodex\n${buildShellInit('powershell.exe', helper)}\ncodex\n`);
      expect(await run('powershell.exe', ['-NoProfile', '-File', script], env)).toContain('kept-alias');
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 30000);
});
