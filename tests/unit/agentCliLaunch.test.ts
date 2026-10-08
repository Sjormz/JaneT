// @vitest-environment node
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { buildSync } from 'esbuild';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentActivityBridge } from '../../src/main/agentActivityBridge';
import { buildShellInit } from '../../src/main/shell-init';
import { parse } from 'smol-toml';
import { applyAgentEvent, agentStatus, type AgentAwareness } from '../../src/renderer/terminalAwareness';

function run(executable: string, args: string[], env: NodeJS.ProcessEnv, input = '', closeInput = true, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, cwd, windowsHide: true });
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

/** Runs `--setup-codex`; returns its session `-c` values, or null when Codex should launch unchanged. */
function setup(helper: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<{ config: string[] | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, '--setup-codex', ...args], { env, cwd, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ config: code === 0 ? stdout.split('\n').filter(Boolean) : null, stderr }));
  });
}

const notifyOf = (config: string[]) => parse(config.find(value => value.startsWith('notify='))!).notify as string[];
const legacyHook = (helper: string) => ({ type: 'command', command: `node '${helper.replace(/\\/g, '/')}' --codex-hook`, timeout: 2, statusMessage: 'JaneT activity' });

// Bundle once: esbuild uses every core, and repeated bundles starve concurrent test files.
let bundleDirectory: string;
let bundle: string;
beforeAll(() => {
  bundleDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-agent-bundle-'));
  bundle = path.join(bundleDirectory, 'agent-cli.cjs');
  buildSync({ entryPoints: ['src/main/agent-cli.ts'], bundle: true, platform: 'node', outfile: bundle });
});
afterAll(() => { if (bundleDirectory) fs.rmSync(bundleDirectory, { recursive: true, force: true }); });

describe('automatic agent launch runtime', () => {
  it('migrates an older persistent install exactly once across concurrent launches', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-codex-batch-'));
    const bridge = new AgentActivityBridge(() => {});
    try {
      const helper = path.join(directory, 'agent-cli.cjs');
      fs.copyFileSync(bundle, helper);
      const codexHome = path.join(directory, 'home'); fs.mkdirSync(codexHome);
      const forwarder = ['node', helper.replace(/\\/g, '/'), '--codex-notify-forward', JSON.stringify(['user-notifier'])];
      fs.writeFileSync(path.join(codexHome, 'config.toml'), `# existing settings\nmodel = "test-model"\nnotify = ${JSON.stringify(forwarder)}\n[projects."elsewhere"]\ntrust_level = "untrusted"\n`);
      fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'mine' }] }, { hooks: [legacyHook(helper)] }] } }));
      const diagnostics = path.join(directory, 'diagnostics.jsonl');
      const env = { ...process.env, ...await bridge.environment('batch'), CODEX_HOME: codexHome, JANET_ACTIVITY_DIAGNOSTICS: diagnostics };
      const projects = Array.from({ length: 12 }, (_, i) => path.join(directory, `project ${i}`));
      projects.forEach(project => fs.mkdirSync(project));
      const results = await Promise.all(projects.map(project => setup(helper, [], env, project)));
      const context = fs.existsSync(diagnostics) ? fs.readFileSync(diagnostics, 'utf8') : 'No setup diagnostics';
      for (const result of results) {
        expect(result.config, context).not.toBeNull();
        expect(notifyOf(result.config!).slice(2, 3)).toEqual(['--codex-notify-forward-b64']);
        expect(result.stderr).not.toContain('could not');
      }
      expect(results.filter(result => result.stderr.includes('Removed entries an older JaneT added'))).toHaveLength(1);
      const config = fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
      expect(config).toBe('# existing settings\nmodel = "test-model"\nnotify = ["user-notifier"]\n[projects."elsewhere"]\ntrust_level = "untrusted"\n');
      expect(JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'))).toEqual({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'mine' }] }] } });
      const after = fs.readdirSync(codexHome).sort();
      await Promise.all(projects.map(project => setup(helper, [], env, project)));
      expect(fs.readdirSync(codexHome).sort()).toEqual(after);
      expect(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')).toBe(config);
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it('returns to Ready through the session notifier while preserving the existing handler inside and outside JaneT', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-codex-forward-'));
    const helper = path.join(directory, 'agent-cli.cjs');
    const outputPath = path.join(directory, 'forwarded.json');
    const originalScript = path.join(directory, 'original.cjs');
    let awareness: AgentAwareness | undefined;
    const bridge = new AgentActivityBridge((_id, event) => { awareness = applyAgentEvent(awareness, event, Date.now(), true); });
    try {
      fs.copyFileSync(bundle, helper);
      fs.writeFileSync(originalScript, `require('fs').writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(process.argv.slice(2)));`);
      const original = [process.execPath, originalScript, 'a b', 'quote"$;&value'];
      const codexHome = path.join(directory, 'codex'); fs.mkdirSync(codexHome);
      const configText = 'notify = ' + JSON.stringify(original) + '\n';
      fs.writeFileSync(path.join(codexHome, 'config.toml'), configText);
      const env = { ...process.env, ...await bridge.environment('terminal'), CODEX_HOME: codexHome };
      const { config } = await setup(helper, [], env);
      expect(config!.every(value => !value.includes('"'))).toBe(true);
      const configured = notifyOf(config!);
      expect(fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8')).toBe(configText);
      expect(agentStatus(awareness!).label).toBe('Codex · Awaiting activity');
      // Real input framing regression: valid JSON, with stdin deliberately left open.
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'one' }), false);
      expect(agentStatus(awareness!).kind).toBe('running');
      const payload = JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'codex', 'turn-id': 'one', 'last-assistant-message': 'private\n"$; & text' });
      await run(configured[0], [...configured.slice(1), payload], env);
      expect(agentStatus(awareness!).label).toBe('Codex · Ready');
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual([...original.slice(2), payload]);
      const outside: NodeJS.ProcessEnv = { ...env }; delete outside.JANET_ACTIVITY_URL;
      fs.rmSync(outputPath);
      await run(configured[0], [...configured.slice(1), payload], outside);
      expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual([...original.slice(2), payload]);
      // A failing original notifier cannot suppress JaneT's completion delivery.
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'one' }));
      fs.writeFileSync(originalScript, 'process.exit(7);');
      await expect(run(configured[0], [...configured.slice(1), payload], env)).rejects.toThrow('Exit 7');
      expect(agentStatus(awareness!).label).toBe('Codex · Ready');
      expect((await setup(helper, ['-c', 'notify=["explicit"]'], env)).stderr).toContain('Explicit notify override');
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'two' }));
      expect(agentStatus(awareness!).label).toBe('Codex · Activity tracking incomplete');
      await setup(helper, [], env);
      expect(agentStatus(awareness!).kind).toBe('running');
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it('follows the selected profile notifier and skips non-session commands', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-codex-profile-'));
    const bridge = new AgentActivityBridge(() => {});
    try {
      const helper = path.join(directory, 'agent-cli.cjs');
      fs.copyFileSync(bundle, helper);
      const codexHome = path.join(directory, 'codex'); fs.mkdirSync(codexHome);
      fs.writeFileSync(path.join(codexHome, 'config.toml'), 'notify = ["root"]\nprofile = "inline"\n[profiles.inline]\nnotify = ["inline"]\n');
      fs.writeFileSync(path.join(codexHome, 'work.config.toml'), 'notify = ["file"]\n');
      const env = { ...process.env, ...await bridge.environment('p'), CODEX_HOME: codexHome };
      const forwarded = async (args: string[]) => {
        const notify = notifyOf((await setup(helper, args, env)).config!);
        return JSON.parse(Buffer.from(notify[3], 'base64url').toString('utf8'));
      };
      expect(await forwarded([])).toEqual(['inline']);
      expect(await forwarded(['-p', 'work', 'resume', '--last'])).toEqual(['file']);
      expect(await forwarded(['--profile', 'missing'])).toEqual(['root']);
      expect(await forwarded(['-m', 'mcp', 'a prompt'])).toEqual(['inline']);
      for (const args of [['--help'], ['-V'], ['mcp', 'list'], ['-c', 'x=1', 'login'], ['features']]) expect((await setup(helper, args, env)).config).toBeNull();
      const outside: NodeJS.ProcessEnv = { ...env }; delete outside.JANET_ACTIVITY_URL;
      expect((await setup(helper, [], outside)).config).toBeNull();
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it('routes real bundled Codex and Hermes helpers without private payload fields', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-cli-runtime-'));
    const helper = path.join(directory, 'agent helper.cjs');
    const events: any[] = [];
    const bridge = new AgentActivityBridge((id, event) => events.push({ id, ...event }));
    try {
      fs.copyFileSync(bundle, helper);
      const env = { ...process.env, ...await bridge.environment('terminal'), CODEX_HOME: path.join(directory, 'codex') };
      expect((await setup(helper, ['--help'], env)).config).toBeNull();
      expect((await setup(helper, [], env)).config).not.toBeNull();
      expect(fs.existsSync(env.CODEX_HOME)).toBe(false);
      await run(process.execPath, [helper, '--codex-hook'], env, JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'codex', turn_id: 'one', prompt: 'secret' }));
      await run(process.execPath, [helper, '--codex-notify', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'codex', 'turn-id': 'one', 'last-assistant-message': 'secret' })], env);
      await run(process.execPath, [helper, '--hermes-hook'], env, JSON.stringify({ hook_event_name: 'pre_llm_call', session_id: 'hermes', extra: { turn_id: 'two', platform: 'tui', user_message: 'secret' } }));
      await run(process.execPath, [helper, '--hermes-hook'], env, JSON.stringify({ hook_event_name: 'on_session_end', session_id: 'child', extra: { turn_id: 'child', completed: true, failed: false, interrupted: false } }));
      await run(process.execPath, [helper, '--hermes-hook'], env, JSON.stringify({ hook_event_name: 'on_session_end', session_id: 'hermes', extra: { turn_id: 'two', completed: true, failed: false, interrupted: false } }));
      expect(events.map(event => event.event)).toEqual(['integration.status', 'session.start', 'turn.start', 'turn.end', 'session.start', 'turn.start', 'turn.end']);
      expect(JSON.stringify(events)).not.toContain('secret');
      expect(events.at(-1)).toMatchObject({ provider: 'hermes', outcome: 'succeeded', id: 'terminal' });
      const invalidHome = path.join(directory, 'not-a-directory');
      const diagnostics = path.join(directory, 'setup-errors.jsonl');
      fs.writeFileSync(invalidHome, 'private configuration');
      const failed = await setup(helper, [], { ...env, CODEX_HOME: invalidHome, JANET_ACTIVITY_DIAGNOSTICS: diagnostics });
      expect(failed.config).toBeNull();
      expect(failed.stderr).toContain('Codex will start normally');
      expect(events.at(-1)).toMatchObject({ event: 'integration.status', completionTracking: false });
      const diagnosticText = fs.readFileSync(diagnostics, 'utf8');
      expect(diagnosticText).not.toContain(directory);
      expect(diagnosticText).not.toContain('private configuration');
      expect(diagnosticText.trim().split('\n').map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ stage: 'helper.setup-error', errorCode: 'ENOTDIR' }));
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it('uninstalls persistent Codex and Hermes entries and reports what changed', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-uninstall-'));
    try {
      const helper = path.join(directory, 'agent-cli.cjs');
      fs.copyFileSync(bundle, helper);
      const codexHome = path.join(directory, 'codex'); fs.mkdirSync(codexHome);
      fs.writeFileSync(path.join(codexHome, 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [legacyHook(helper)] }] } }));
      const hermesHome = path.join(directory, 'hermes'); fs.mkdirSync(path.join(hermesHome, 'profiles', 'work'), { recursive: true });
      const hermesHook = `node "${helper.replace(/\\/g, '/')}" --hermes-hook`;
      const yaml = (extra: string) => `# keep comment\nmodel: x\nhooks:\n  pre_llm_call:\n    - command: mine\n${extra}`;
      fs.writeFileSync(path.join(hermesHome, 'config.yaml'), yaml(`    - command: '${hermesHook}'\n      timeout: 2\n  on_session_end:\n    - command: '${hermesHook}'\n      timeout: 2\n`));
      fs.writeFileSync(path.join(hermesHome, 'profiles', 'work', 'config.yaml'), `hooks:\n  pre_llm_call:\n    - command: '${hermesHook}'\n      timeout: 2\n`);
      const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome, HERMES_HOME: hermesHome, LOCALAPPDATA: path.join(directory, 'none'), HOME: path.join(directory, 'none'), USERPROFILE: path.join(directory, 'none') };
      delete env.JANET_ACTIVITY_URL;
      const output = await run(process.execPath, [helper, '--uninstall'], env);
      expect(output).toContain('Codex: removed JaneT entries from 1 file(s).');
      expect(output).toContain('Hermes: removed JaneT hooks from 2 file(s).');
      expect(JSON.parse(fs.readFileSync(path.join(codexHome, 'hooks.json'), 'utf8'))).toEqual({ hooks: {} });
      expect(fs.readFileSync(path.join(hermesHome, 'config.yaml'), 'utf8')).toBe(yaml(''));
      expect(fs.readFileSync(path.join(hermesHome, 'profiles', 'work', 'config.yaml'), 'utf8')).toBe('{}\n');
      expect(await run(process.execPath, [helper, '--uninstall'], env)).toBe('Codex: nothing to remove.\nHermes: nothing to remove.\n');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }, 25000);

  it.skipIf(process.platform !== 'win32')('PowerShell codex launches pass session config intact to a native executable', async () => {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "janet launch's "));
    const bridge = new AgentActivityBridge(() => {});
    try {
      const helper = path.join(directory, 'helper.cjs');
      fs.copyFileSync(bundle, helper);
      // A native executable exercises Windows PowerShell 5.1 argument quoting; a .ps1 stub would not.
      const source = 'using System; using System.Text; public static class P { public static int Main(string[] a) { var s = new StringBuilder("ARGS="); foreach (var x in a) s.Append("<").Append(x).Append(">"); Console.WriteLine(s); Console.WriteLine("TERM=" + Environment.GetEnvironmentVariable("TERM")); string line; while (Console.IsInputRedirected && (line = Console.In.ReadLine()) != null) Console.WriteLine("INPUT=" + line); return 37; } }';
      const compile = path.join(directory, 'compile.ps1');
      fs.writeFileSync(compile, `Add-Type -TypeDefinition '${source.replace(/'/g, "''")}' -OutputType ConsoleApplication -OutputAssembly '${path.join(directory, 'codex.exe').replace(/'/g, "''")}'`);
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', compile], process.env);
      fs.writeFileSync(path.join(directory, 'node.ps1'), 'throw "The Node script shim must not run."');
      const codexHome = path.join(directory, 'codex-home'); fs.mkdirSync(codexHome);
      fs.writeFileSync(path.join(codexHome, 'config.toml'), 'notify = ["C:\\\\tools\\\\my notifier.exe", "quote\\"arg"]\n');
      const script = path.join(directory, 'test.ps1');
      const env = { ...process.env, ...await bridge.environment('ps'), TERM: 'xterm-256color', CODEX_HOME: codexHome, PATH: directory + path.delimiter + process.env.PATH };
      const launch = async (line: string) => {
        fs.writeFileSync(script, `${buildShellInit('powershell.exe', helper)}\n${line}\n[Console]::WriteLine("EXIT=$LASTEXITCODE")\n`);
        return run('powershell.exe', ['-NoProfile', '-File', script], env);
      };
      const output = await launch("codex 'a b' --resume");
      const args = [...output.matchAll(/<([^>]*)>/g)].map(match => match[1]);
      expect(output).toContain('EXIT=37');
      expect(output).toContain('TERM=xterm-256color');
      expect(args.slice(-2)).toEqual(['a b', '--resume']);
      const config = args.filter((_, index) => args[index - 1] === '-c');
      expect(config).toHaveLength(8);
      for (const value of config) expect(() => parse(value)).not.toThrow();
      const notify = parse(config.at(-1)!).notify as string[];
      expect(notify.slice(0, 3)).toEqual(['node', helper.replace(/\\/g, '/'), '--codex-notify-forward-b64']);
      expect(JSON.parse(Buffer.from(notify[3], 'base64url').toString('utf8'))).toEqual(['C:\\tools\\my notifier.exe', 'quote"arg']);
      const hook = (parse(config[0]) as any).hooks.SessionStart[0].hooks[0];
      expect(hook).toEqual({ type: 'command', command: `node '${helper.replace(/\\/g, '/').replace(/'/g, "''")}' --codex-hook`, timeout: 2, statusMessage: 'JaneT activity' });
      expect(fs.readdirSync(codexHome)).toEqual(['config.toml']);
      expect(await launch('codex --version')).toContain('ARGS=<--version>');
      expect(await launch("'prompt from pipe' | codex -")).toContain('INPUT=prompt from pipe');
      // User aliases remain untouched instead of being replaced by JaneT's wrapper.
      expect(await launch(`function MyCodex { 'kept-alias' }; Set-Alias codex MyCodex\n${buildShellInit('powershell.exe', helper)}\ncodex`)).toContain('kept-alias');
    } finally { bridge.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  }, 60000);
});
