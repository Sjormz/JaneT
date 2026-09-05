import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as load } from 'yaml';
import { hermesActivityHome, installHermesActivity, mapHermesActivity } from '../../src/main/hermesActivitySetup';

function fixture(run: (root: string, env: NodeJS.ProcessEnv) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'janet-hermes-'));
  try { run(root, { HERMES_HOME: root }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe('Hermes activity setup', () => {
  it('backs up and preserves configuration/hooks, leaves consent untouched, and is idempotent', () => fixture((root, env) => {
    const file = path.join(root, 'config.yaml');
    const original = 'model: existing\nhooks_auto_accept: false\nhooks:\n  pre_llm_call:\n    - command: existing\nplugins:\n  disabled: [janet]\n';
    fs.writeFileSync(file, original);
    const helper = path.join(root, 'JaneT helper.cjs');
    expect(installHermesActivity(helper, ['--tui'], env).message).toContain('first-use');
    const result = load(fs.readFileSync(file, 'utf8')) as any;
    expect(result.model).toBe('existing');
    expect(result.hooks_auto_accept).toBe(false);
    expect(result.plugins.disabled).toEqual(['janet']);
    expect(result.hooks.pre_llm_call).toHaveLength(2);
    expect(result.hooks.pre_llm_call[0]).toEqual({ command: 'existing' });
    expect(result.hooks.pre_llm_call[1].command).toContain('--hermes-hook');
    const backup = fs.readdirSync(root).find(name => name.includes('.janet-backup-'))!;
    expect(fs.readFileSync(path.join(root, backup), 'utf8')).toBe(original);
    const installed = fs.readFileSync(file, 'utf8');
    expect(installHermesActivity(helper, ['--tui'], env)).toEqual({});
    expect(fs.readFileSync(file, 'utf8')).toBe(installed);
    expect(fs.readdirSync(root)).toHaveLength(2);
  }));

  it('preserves existing comments when adding a new hooks section, skips safe mode and absent configs', () => fixture((root, env) => {
    const helper = path.join(root, 'helper.cjs');
    expect(installHermesActivity(helper, [], env).message).toContain('after Hermes setup');
    expect(fs.readdirSync(root)).toEqual([]);
    const file = path.join(root, 'config.yaml');
    const text = '# comments\nmodel: existing\n';
    fs.writeFileSync(file, text);
    installHermesActivity(helper, [], { ...env, HERMES_SAFE_MODE: 'true' });
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    installHermesActivity(helper, ['--safe-mode'], env);
    installHermesActivity(helper, ['--ignore-user-config'], env);
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
    installHermesActivity(helper, [], env);
    expect(fs.readFileSync(file, 'utf8')).toContain(text);
  }));

  it('resolves explicit/sticky/profile-home selection without creating missing or deleted profiles', () => fixture((root, env) => {
    const alpha = path.join(root, 'profiles', 'alpha');
    const beta = path.join(root, 'profiles', 'beta');
    fs.mkdirSync(alpha, { recursive: true }); fs.mkdirSync(beta);
    fs.writeFileSync(path.join(root, 'active_profile'), 'alpha');
    expect(hermesActivityHome(['--tui'], env)).toBe(alpha);
    expect(hermesActivityHome(['--tui', '-p', 'beta'], env)).toBe(beta);
    expect(hermesActivityHome(['--profile=beta', '--tui'], env)).toBe(beta);
    expect(hermesActivityHome(['--profile', 'default'], env)).toBe(root);
    expect(hermesActivityHome(['--tui'], { HERMES_HOME: beta })).toBe(beta);
    expect(hermesActivityHome(['--profile=alpha'], { HERMES_HOME: beta })).toBe(alpha);
    expect(hermesActivityHome(['--model', '--profile=beta'], env)).toBe(alpha);
    expect(hermesActivityHome(['--', '--profile=beta'], env)).toBe(alpha);
    expect(hermesActivityHome(['mcp', 'add', '--args', '--profile=beta'], env)).toBe(alpha);
    expect(() => hermesActivityHome(['--profile=../bad'], env)).toThrow();
    expect(() => hermesActivityHome(['--profile=missing'], env)).toThrow();
    fs.mkdirSync(path.join(root, 'profiles', '.deleted'));
    fs.writeFileSync(path.join(root, 'profiles', '.deleted', 'beta'), 'deleted');
    expect(() => hermesActivityHome(['--profile=beta'], env)).toThrow();
  }));

  it('refuses malformed YAML, unexpected hooks and duplicate keys without changes', () => fixture((root, env) => {
    const file = path.join(root, 'config.yaml');
    for (const text of ['[bad', 'hooks: false\n', 'hooks:\n  pre_llm_call: nope\n', 'model: a\nmodel: b\n']) {
      fs.writeFileSync(file, text);
      expect(() => installHermesActivity(path.join(root, 'helper.cjs'), [], env)).toThrow();
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
      expect(fs.readdirSync(root)).toEqual(['config.yaml']);
    }
  }));

  it('updates an explicitly ended YAML document without appending invalid trailing content', () => fixture((root, env) => {
    const file = path.join(root, 'config.yaml');
    fs.writeFileSync(file, '---\nmodel: existing\n...\n');
    installHermesActivity(path.join(root, 'helper.cjs'), [], env);
    expect(load(fs.readFileSync(file, 'utf8'))).toMatchObject({ model: 'existing', hooks: { pre_llm_call: expect.any(Array) } });
  }));

  it('preserves unrelated YAML 1.1 scalars and comments with existing hooks', () => fixture((root, env) => {
    const file = path.join(root, 'config.yaml');
    const text = '# keep my comments\nfeature: yes\nmode: on\ndate: 2026-09-05\nhooks:\n  # keep existing hook\n  pre_llm_call:\n    - command: existing # important\n';
    fs.writeFileSync(file, text);
    installHermesActivity(path.join(root, 'helper.cjs'), [], env);
    const updated = fs.readFileSync(file, 'utf8');
    for (const literal of ['# keep my comments', 'feature: yes', 'mode: on', 'date: 2026-09-05', '# keep existing hook', 'command: existing # important']) expect(updated).toContain(literal);
  }));

  it('refuses aliases and linked parent directories without writing through them', () => fixture((root, env) => {
    const file = path.join(root, 'config.yaml');
    fs.writeFileSync(file, 'original: &shared {}\nhooks: *shared\n');
    expect(() => installHermesActivity(path.join(root, 'helper.cjs'), [], env)).toThrow('hooks must be a mapping');
    const target = path.join(root, 'target');
    const link = path.join(root, 'linked');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'config.yaml'), 'model: existing\n');
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(() => installHermesActivity(path.join(root, 'helper.cjs'), [], { HERMES_HOME: link })).toThrow('Linked');
      expect(fs.readdirSync(target)).toEqual(['config.yaml']);
    } finally { fs.unlinkSync(link); }
  }));

  it.runIf(process.platform === 'win32')('uses the native Windows Hermes root, not a dot-directory', () => fixture((root) => {
    expect(hermesActivityHome([], { LOCALAPPDATA: root })).toBe(path.join(root, 'hermes'));
  }));
});

describe('Hermes shell hook normalization', () => {
  const event = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({ hook_event_name, session_id: 'session', extra: { turn_id: 'turn', ...extra }, tool_input: 'private' });
  it('maps authoritative top-level turn outcomes without forwarding private content', () => {
    expect(mapHermesActivity(event('pre_llm_call', { user_message: 'private' }))).toEqual({ version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session', turnId: 'turn' });
    expect(mapHermesActivity(event('on_session_end', { completed: true, failed: false, interrupted: false }))).toMatchObject({ event: 'turn.end', outcome: 'succeeded' });
    expect(mapHermesActivity(event('on_session_end', { failed: true }))).toMatchObject({ outcome: 'failed' });
    expect(mapHermesActivity(event('on_session_end', { interrupted: true }))).toMatchObject({ outcome: 'interrupted' });
    expect(mapHermesActivity(event('on_session_end'))).toBeNull();
    expect(mapHermesActivity(event('post_tool_call'))).toBeNull();
    expect(mapHermesActivity(event('pre_llm_call', { parent_session_id: 'parent' }))).toBeNull();
  });
  it('requires real approval session/turn IDs, ignores smart approval and accepts session teardown', () => {
    expect(mapHermesActivity(event('pre_approval_request', { surface: 'cli' }))).toMatchObject({ event: 'attention.request' });
    expect(mapHermesActivity(event('post_approval_response', { surface: 'cli', choice: 'deny' }))).toMatchObject({ event: 'attention.resolve' });
    expect(mapHermesActivity(event('pre_approval_request', { surface: 'smart' }))).toBeNull();
    expect(mapHermesActivity(event('post_approval_response', { surface: 'cli', choice: 'unknown' }))).toBeNull();
    expect(mapHermesActivity({ ...event('pre_approval_request', { session_key: 'routing-not-identity' }), session_id: '' })).toBeNull();
    expect(mapHermesActivity(event('pre_llm_call', { turn_id: '\u0000' }))).toBeNull();
    expect(mapHermesActivity({ hook_event_name: 'on_session_finalize', session_id: 'session', extra: {} })).toEqual({ version: 1, provider: 'hermes', sessionId: 'session', event: 'session.end' });
  });
});
