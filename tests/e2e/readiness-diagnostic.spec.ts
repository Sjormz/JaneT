import { test, expect, _electron as electron } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { firstWindow, forceClose, electronEnv } from './electronLifecycle';
import { terminalSettings } from './workspaces';

test('diagnoses initial shell readiness without hiding a five-second miss', async ({}, testInfo) => {
  const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'janet-readiness-'));
  const log = path.join(profile, 'startup.jsonl');
  const hook = path.join(profile, 'probe.cjs');
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify(terminalSettings(profile)));
  fs.writeFileSync(hook, `
const { app, ipcMain } = require('electron');
const fs = require('node:fs');
const log = (event, detail) => fs.appendFileSync(process.env.JANET_READINESS_LOG, JSON.stringify({ at: Date.now(), event, ...detail }) + '\\n');
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (...args) => {
  if (channel !== 'terminal:create') return listener(...args);
  log('create', args[1]);
  try { const result = await listener(...args); log('created', result); return result; }
  catch (error) { log('create-error', { message: error.message }); throw error; }
});
ipcMain.on('terminal:acknowledgeOutput', (_event, acknowledgement) => log('parsed', acknowledgement));
app.on('web-contents-created', (_event, contents) => {
  const send = contents.send.bind(contents);
  contents.send = (channel, ...args) => {
    if (channel === 'terminal:onData') log('output', args[0]);
    if (channel === 'terminal:onExit') log('exit', args[0]);
    return send(channel, ...args);
  };
});
`);
  const app = await electron.launch({
    args: ['--require', hook, '.'], cwd: path.resolve(__dirname, '../..'),
    env: electronEnv({ NODE_ENV: 'test', JANET_E2E_USER_DATA_DIR: profile,
      JANET_READINESS_LOG: log, CODEX_HOME: path.join(profile, 'codex') }),
  });
  let failure: unknown;
  try {
    const page = await firstWindow(app);
    const started = Date.now();
    // Measurement only: preserve the original five-second failure even when a later prompt arrives.
    await expect.poll(() => page.locator('.xterm-helper-textarea').getAttribute('data-shell-ready'), {
      timeout: 15_000, intervals: [100],
    }).toBe('true');
    const readyAfter = Date.now() - started;
    const events = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    const output = events.filter(event => event.event === 'output').map(event => event.data).join('');
    const summary = { readyAfter, create: events.find(event => event.event === 'create')?.at,
      created: events.find(event => event.event === 'created')?.at,
      firstOutput: events.find(event => event.event === 'output')?.at,
      startupMarker: output.includes('\x1b]777;janet-ready'), promptMarker: output.includes('\x1b]133;B'),
      parsed: events.filter(event => event.event === 'parsed').length };
    console.log('[readiness-probe]', JSON.stringify(summary));
    await testInfo.attach('readiness-summary', { body: JSON.stringify(summary), contentType: 'application/json' });
    expect(readyAfter).toBeLessThan(5_000);
  } catch (error) { failure = error; throw error; }
  finally {
    try {
      await forceClose(app);
      if (fs.existsSync(log)) await testInfo.attach('readiness-output', { body: fs.readFileSync(log), contentType: 'application/jsonl' });
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (error) { if (!failure) throw error; console.error(error); }
  }
});
