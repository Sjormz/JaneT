import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeCodexActivity } from '../../src/main/codexActivitySetup';
import { parse } from 'smol-toml';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));

const helper = 'C:/Users/me/AppData/Roaming/janet/agent-activity/agent-cli.cjs';
const janetHook = (script = helper) => ({ type: 'command', command: `node '${script}' --codex-hook`, timeout: 2, statusMessage: 'JaneT activity' });
const forwarder = (original: string[]) => ['node', helper, '--codex-notify-forward', JSON.stringify(original)];
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Interrupt'];

const directories: string[] = [];
function fixture(config = '# preserve comments\n[features]\nhooks = true\n', hooks?: unknown) {
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'janet-codex-cleanup-'));
  directories.push(directory);
  fs.writeFileSync(join(directory, 'config.toml'), config);
  if (hooks !== undefined) fs.writeFileSync(join(directory, 'hooks.json'), JSON.stringify(hooks, null, 2));
  return { directory, configPath: join(directory, 'config.toml'), hooksPath: join(directory, 'hooks.json') };
}
const legacyHooks = (extra: Record<string, unknown> = {}) => ({ ...extra, hooks: Object.fromEntries(EVENTS.map(event => [event, [{ hooks: [janetHook()] }]])) });
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('removing persistent Codex entries from older JaneT builds', () => {
  it('leaves an untouched Codex home completely unchanged, without a lock or backup', () => {
    const f = fixture('model = "keep"\nnotify = ["mine"]\n', { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } });
    const before = fs.readdirSync(f.directory).map(name => [name, fs.statSync(join(f.directory, name)).mtimeMs]);
    expect(removeCodexActivity(f.directory)).toEqual({ changed: [] });
    expect(fs.readdirSync(f.directory).map(name => [name, fs.statSync(join(f.directory, name)).mtimeMs])).toEqual(before);
    expect(removeCodexActivity(join(f.directory, 'missing'))).toEqual({ changed: [] });
    expect(fs.existsSync(join(f.directory, 'missing'))).toBe(false);
  });

  it('removes only JaneT hooks, keeps user hooks and empty user lists, and backs up', () => {
    const f = fixture('# keep\n', {
      description: 'Mine',
      hooks: {
        ...legacyHooks().hooks,
        SessionStart: [{ matcher: 'm', hooks: [{ type: 'command', command: 'mine' }, janetHook()] }, { hooks: [janetHook('C:/other/janet-dev/agent-activity/agent-cli.cjs')] }],
        Stop: [],
      },
    });
    expect(removeCodexActivity(f.directory).changed).toEqual([f.hooksPath]);
    const hooks = JSON.parse(fs.readFileSync(f.hooksPath, 'utf8'));
    expect(hooks).toEqual({ description: 'Mine', hooks: { SessionStart: [{ matcher: 'm', hooks: [{ type: 'command', command: 'mine' }] }], Stop: [] } });
    expect(fs.readdirSync(f.directory).filter(name => name.includes('janet-backup'))).toHaveLength(1);
    expect(removeCodexActivity(f.directory)).toEqual({ changed: [] });
  });

  it('keeps look-alike hooks that JaneT did not write', () => {
    const lookAlike = [{ ...janetHook(), statusMessage: 'Mine' }, { ...janetHook(), command: `node '${helper}' --codex-hook --extra` }];
    const f = fixture('', { hooks: { SessionStart: [{ hooks: lookAlike }] } });
    expect(removeCodexActivity(f.directory)).toEqual({ changed: [] });
  });

  it.each(['notify', '"notify"', "'notify'"])('restores the original %s handler and preserves unrelated text', key => {
    const f = fixture(`# top\n${key} = ${JSON.stringify(forwarder(['existing', '--arg']))} # mine\nmodel = "keep"\n`);
    expect(removeCodexActivity(f.directory).changed).toEqual([f.configPath]);
    const next = fs.readFileSync(f.configPath, 'utf8');
    expect(next).toBe(`# top\n${key} = ["existing","--arg"] # mine\nmodel = "keep"\n`);
  });

  it('deletes a notify line that only ever held JaneT', () => {
    const f = fixture(`notify = ${JSON.stringify(forwarder([]))}\n# preserve comments\nmodel = "keep"\n`);
    removeCodexActivity(f.directory);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe('# preserve comments\nmodel = "keep"\n');
  });

  it('returns a computer-use callback to its own form and keeps its previous notifier', () => {
    const computer = 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\codex-computer-use.exe';
    const onlyJanet = [computer, 'turn-ended', '--previous-notify', JSON.stringify(forwarder([]))];
    const withUser = [computer, 'turn-ended', '--previous-notify', JSON.stringify(forwarder(['user-notifier', 'x']))];
    const f = fixture(`notify = ${JSON.stringify(onlyJanet)}\n[profiles.work]\nnotify = ${JSON.stringify(withUser)}\n`);
    removeCodexActivity(f.directory);
    const config = parse(fs.readFileSync(f.configPath, 'utf8')) as any;
    expect(config.notify).toEqual([computer, 'turn-ended']);
    expect(config.profiles.work.notify).toEqual([computer, 'turn-ended', '--previous-notify', '["user-notifier","x"]']);
  });

  it('cleans profile files and keeps the other values', () => {
    const f = fixture('# user config\n');
    const profile = join(f.directory, 'work.config.toml');
    fs.writeFileSync(profile, `model = "keep"\nnotify = ${JSON.stringify(forwarder(['existing']))}\n`);
    expect(removeCodexActivity(f.directory).changed).toEqual([profile]);
    expect(parse(fs.readFileSync(profile, 'utf8'))).toEqual({ model: 'keep', notify: ['existing'] });
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe('# user config\n');
  });

  it('fails before writing for malformed data and oversized files', () => {
    const f = fixture('bad = [');
    expect(() => removeCodexActivity(f.directory)).toThrow();
    fs.writeFileSync(f.configPath, '#'.repeat(1024 * 1024 + 1));
    expect(() => removeCodexActivity(f.directory)).toThrow(/large/);
    fs.writeFileSync(f.configPath, ''); fs.writeFileSync(f.hooksPath, '{');
    expect(() => removeCodexActivity(f.directory)).toThrow();
    expect(fs.readdirSync(f.directory).sort()).toEqual(['config.toml', 'hooks.json']);
  });

  it('does not touch another cleanup lock', () => {
    const f = fixture('', legacyHooks());
    fs.writeFileSync(join(f.directory, '.janet-activity.lock'), 'another launch');
    expect(removeCodexActivity(f.directory).message).toMatch(/Another JaneT cleanup/);
    expect(fs.readFileSync(join(f.directory, '.janet-activity.lock'), 'utf8')).toBe('another launch');
    expect(JSON.parse(fs.readFileSync(f.hooksPath, 'utf8'))).toEqual(legacyHooks());
  }, 7000);

  it('refuses directory links rather than changing their targets', () => {
    const f = fixture();
    const alias = join(f.directory, 'alias');
    const target = join(f.directory, 'target');
    fs.mkdirSync(target);
    fs.writeFileSync(join(target, 'hooks.json'), JSON.stringify(legacyHooks()));
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => removeCodexActivity(alias)).toThrow(/symbolic links/);
    expect(fs.readdirSync(target)).toEqual(['hooks.json']);
  });

  it('preserves an external edit observed just before replacing a file', () => {
    const f = fixture(`notify = ${JSON.stringify(forwarder(['mine']))}\n`);
    const write = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
      write(target, data, options);
      if (String(target).startsWith(f.configPath + '.janet-tmp-')) write(f.configPath, '# edited externally\n');
    });
    expect(() => removeCodexActivity(f.directory)).toThrow(/changed during setup/);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe('# edited externally\n');
  });

  it.skipIf(process.platform !== 'win32')('retries a replace blocked by a concurrent reader, rechecking for edits each time', () => {
    const f = fixture(`notify = ${JSON.stringify(forwarder(['mine']))}\n`);
    const rename = fs.renameSync;
    let blocked = 0;
    const sharingViolation = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM', syscall: 'rename' });
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (target === f.configPath && blocked < 3) { blocked++; throw sharingViolation(); }
      rename(source, target);
    });
    expect(removeCodexActivity(f.directory).changed).toEqual([f.configPath]);
    expect(blocked).toBe(3);
    expect(parse(fs.readFileSync(f.configPath, 'utf8')).notify).toEqual(['mine']);
    // An edit made while the replace is blocked is never overwritten.
    fs.writeFileSync(f.configPath, `notify = ${JSON.stringify(forwarder(['mine']))}\n`);
    spy.mockImplementation((source, target) => {
      if (target === f.configPath) { fs.writeFileSync(f.configPath, '# edited externally\n'); throw sharingViolation(); }
      rename(source, target);
    });
    expect(() => removeCodexActivity(f.directory)).toThrow(/changed during setup/);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe('# edited externally\n');
    expect(fs.readdirSync(f.directory).some(name => name.includes('janet-tmp') || name.endsWith('.lock'))).toBe(false);
  });

  it('rolls back an earlier save if a later rename fails, but never over a user edit', () => {
    const config = `notify = ${JSON.stringify(forwarder(['mine']))}\n`;
    const f = fixture(config, legacyHooks());
    const original = fs.readFileSync(f.hooksPath, 'utf8');
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (target === f.hooksPath) throw new Error('simulated save failure');
      rename(source, target);
    });
    expect(() => removeCodexActivity(f.directory)).toThrow(/save failure/);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe(config);
    expect(fs.readFileSync(f.hooksPath, 'utf8')).toBe(original);
    expect(fs.readdirSync(f.directory).some(name => name.includes('janet-tmp') || name.endsWith('.lock'))).toBe(false);
    spy.mockImplementation((source, target) => {
      if (target === f.hooksPath) { fs.writeFileSync(f.configPath, '# user edit\n'); throw new Error('save failed'); }
      rename(source, target);
    });
    expect(() => removeCodexActivity(f.directory)).toThrow(/save failed/);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe('# user edit\n');
  });
});
