// Opt-in real CLI regression against a disposable local-test profile.
// No real model, account configuration, credentials, or fabricated lifecycle callbacks.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSync } from 'esbuild';
import pty from 'node-pty';
import { parse } from 'smol-toml';

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-real-codex-'));
const home = path.join(root, 'home'), cwd = path.join(root, 'work');
fs.mkdirSync(home); fs.mkdirSync(cwd);
const configPath = path.join(home, 'config.toml');
fs.writeFileSync(configPath, 'model = "test-model"\nmodel_provider = "local_test"\n[features]\nhooks = true\n[model_providers.local_test]\nname = "Local test"\nbase_url = "http://127.0.0.1:1/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[projects.' + JSON.stringify(fs.realpathSync(cwd)) + ']\ntrust_level = "trusted"\n');
const cliPath = process.env.JANET_CODEX_TEST_BINARY || path.join(process.env.LOCALAPPDATA, 'Programs/OpenAI/Codex/bin/codex.exe');
const helper = path.join(root, 'agent-cli.cjs');
fs.copyFileSync(path.resolve('dist/main/agent-cli.cjs'), helper);
const require = createRequire(import.meta.url);
const runtime = path.join(root, 'runtime.cjs');
buildSync({ stdin: { contents: "export {AgentActivityBridge} from './src/main/agentActivityBridge'; export {applyAgentEvent,agentStatus} from './src/renderer/terminalAwareness';", resolveDir: process.cwd() }, bundle: true, platform: 'node', outfile: runtime });
const { AgentActivityBridge, applyAgentEvent, agentStatus } = require(runtime);
process.env.JANET_ACTIVITY_DIAGNOSTICS = path.join(root, 'regression-diagnostics.jsonl');
let awareness, completed = 0, requests = 0, cli, screen = '';
const phases = [];
const bridge = new AgentActivityBridge((_id, event) => {
  awareness = applyAgentEvent(awareness, event, Date.now(), true);
  phases.push(agentStatus(awareness).kind);
  if (event.event === 'turn.end' && event.outcome === 'succeeded') completed++;
});
const server = http.createServer((req, res) => {
  req.resume();
  if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404).end(); return; }
  requests++;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const id = `resp_${requests}`;
  const item = { id: `msg_${requests}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'LOCAL TEST COMPLETE', annotations: [] }] };
  emit({ type: 'response.created', response: { id, object: 'response', status: 'in_progress', output: [] } });
  // Make the busy phase observable, independently of how quickly the mock can answer.
  setTimeout(() => {
    if (res.destroyed) return;
    emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    emit({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'LOCAL TEST COMPLETE' });
    emit({ type: 'response.output_item.done', output_index: 0, item });
    emit({ type: 'response.completed', response: { id, object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
    res.end();
  }, 700);
});
async function until(condition, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!condition()) {
    if (/Hooks need review|Set up the Codex agent sandbox|Do you trust the contents/.test(screen)) throw Error('Test profile needs normal CLI onboarding/review; no approval is automated by this test');
    assert.ok(Date.now() < end, `Timed out: ${label}; phases=${phases.join(',')}, requests=${requests}`);
    await delay(50);
  }
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, ...await bridge.environment('test'), CODEX_HOME: home, TERM: 'xterm-256color' };
  delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
  await new Promise((resolve, reject) => {
    const setup = spawn(process.execPath, [helper, '--setup-codex'], { cwd, env, windowsHide: true, stdio: 'ignore' });
    setup.on('error', reject); setup.on('exit', code => code === 0 ? resolve() : reject(Error(`Setup exited ${code}`)));
  });
  assert.deepEqual(parse(fs.readFileSync(configPath, 'utf8')).projects, { [fs.realpathSync(cwd)]: { trust_level: 'trusted' } });
  const args = ['--no-alt-screen', '--sandbox', 'read-only', '--dangerously-bypass-hook-trust', '-c', `model_providers.local_test.base_url="http://127.0.0.1:${server.address().port}/v1"`];
  // Negative control: the same real CLI must fail when its completion callback is removed.
  if (process.env.JANET_CODEX_TEST_DISABLE_NOTIFY === '1') args.push('-c', 'notify=[]');
  cli = pty.spawn(cliPath, args, { cwd, env, cols: 120, rows: 40 });
  cli.onData(data => {
    screen = (screen + data).slice(-30000);
    if (data.includes('\x1b[6n')) cli.write('\x1b[1;1R');
  });
  await until(() => screen.includes('Ask Codex to do anything'), 'CLI ready');
  for (let turn = 1; turn <= 2; turn++) {
    cli.write(`Say hello ${turn}`); await delay(200); cli.write('\r');
    await until(() => agentStatus(awareness).kind === 'running', `turn ${turn} busy`);
    await until(() => completed === turn, `turn ${turn} completion callback`);
    assert.equal(agentStatus(awareness).label, 'Codex · Ready');
    assert.ok(screen.includes('LOCAL TEST COMPLETE'));
    // Let the TUI consume its finished event before typing the next prompt.
    await delay(300);
  }
  console.log(JSON.stringify({ result: 'PASS', cli: cliPath, completed, requests, phases, diagnostics: process.env.JANET_ACTIVITY_DIAGNOSTICS }));
} finally {
  cli?.kill(); bridge.close(); server.closeAllConnections(); server.close();
}
