import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexLaunchDirectory, installCodexActivity } from '../../src/main/codexActivitySetup';
import { parse } from 'smol-toml';

vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>() }));

const directories: string[] = [];
function fixture(config = '# preserve comments\n[features]\nhooks = true\n') {
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'janet-codex-setup-'));
  directories.push(directory);
  fs.writeFileSync(join(directory, 'config.toml'), config);
  return { directory, helper: join(directory, 'activity helper.cjs'), configPath: join(directory, 'config.toml'), hooksPath: join(directory, 'hooks.json') };
}
afterEach(() => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('automatic Codex setup', () => {
  it('saves exact directory trust once while preserving config and explicit untrusted entries', () => {
    const f = fixture('# keep this\n[projects."elsewhere"]\ntrust_level = "untrusted"\n');
    installCodexActivity(f.directory, f.helper, f.directory);
    const next = fs.readFileSync(f.configPath, 'utf8');
    expect(parse(next).projects).toEqual({ elsewhere: { trust_level: 'untrusted' }, [f.directory]: { trust_level: 'trusted' } });
    expect(next).toContain('# keep this');
    installCodexActivity(f.directory, f.helper, f.directory);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe(next);
    fs.writeFileSync(f.configPath, next.replace('trust_level = "trusted"', 'trust_level = "untrusted"'));
    installCodexActivity(f.directory, f.helper, f.directory);
    expect((parse(fs.readFileSync(f.configPath, 'utf8')).projects as any)[f.directory].trust_level).toBe('untrusted');
  });

  it('resolves Codex working directories without treating prompt or option values as directory flags', () => {
    const f = fixture();
    const child = join(f.directory, "project's folder"); fs.mkdirSync(child);
    for (const args of [[], ['resume', '--last'], ['--model', 'test-model']]) {
      expect(codexLaunchDirectory(args, f.directory)).toBe(f.directory);
    }
    for (const args of [['-C', child], [`--cd=${child}`], [`-C${child}`], ['--cd', "project's folder"]]) {
      expect(codexLaunchDirectory(args, f.directory)).toBe(child);
    }
    for (const args of [['--', '--cd', child], ['explain', '-C', child], ['--remote', 'ws://localhost:1234'],
      ['--unknown-option', child], ['-C'], ['--model', '-C'], ['login']]) {
      expect(codexLaunchDirectory(args, f.directory)).toBeUndefined();
    }
  });

  it('preserves config and existing hooks, and repeated launches do not write or back up again', () => {
    const f = fixture();
    const config = fs.readFileSync(f.configPath, 'utf8');
    fs.writeFileSync(f.hooksPath, JSON.stringify({ description: 'Mine', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing' }] }] } }));
    expect(installCodexActivity(f.directory, f.helper).message).toBeUndefined();
    const hooks = JSON.parse(fs.readFileSync(f.hooksPath, 'utf8'));
    expect(hooks.description).toBe('Mine');
    expect(hooks.hooks.SessionStart).toHaveLength(2);
    expect(hooks.hooks.Stop).toBeUndefined();
    expect(fs.readFileSync(f.configPath, 'utf8')).toContain(config);
    const before = fs.readdirSync(f.directory).map(name => [name, fs.statSync(join(f.directory, name)).mtimeMs]);
    installCodexActivity(f.directory, f.helper);
    expect(fs.readdirSync(f.directory).map(name => [name, fs.statSync(join(f.directory, name)).mtimeMs])).toEqual(before);
    expect(before.filter(([name]) => String(name).includes('backup'))).toHaveLength(2);
  });

  it.each(['notify', '"notify"', "'notify'"])("forwards an existing %s handler and preserves unrelated text", key => {
    const config = `${key} = ["existing", "--arg"]\n`;
    const f = fixture(config);
    expect(installCodexActivity(f.directory, f.helper).message).toBeUndefined();
    const next = fs.readFileSync(f.configPath, 'utf8');
    expect(next.startsWith(key + ' = ')).toBe(true);
    expect(JSON.parse((parse(next).notify as string[])[3])).toEqual(['existing', '--arg']);
    installCodexActivity(f.directory, f.helper);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe(next);
  });

  it.each(['legacy', 'file'])('preserves %s profile notification configuration', kind => {
    const f = fixture(kind === 'legacy' ? '[profiles.work]\nnotify = ["existing"]\n' : '# user config\n');
    if (kind === 'file') fs.writeFileSync(join(f.directory, 'work.config.toml'), 'notify = ["existing"]\n');
    const config = fs.readFileSync(f.configPath, 'utf8');
    expect(installCodexActivity(f.directory, f.helper).message).toBeUndefined();
    const next = parse(fs.readFileSync(kind === 'file' ? join(f.directory, 'work.config.toml') : f.configPath, 'utf8')) as any;
    expect(JSON.parse((kind === 'file' ? next.notify : next.profiles.work.notify)[3])).toEqual(['existing']);
    expect(fs.readFileSync(f.configPath, 'utf8')).toContain(kind === 'file' ? config : '[profiles.work]');
  });

  it('fails before configuration writes for malformed data and oversized files', () => {
    const f = fixture('bad = [');
    expect(() => installCodexActivity(f.directory, f.helper)).toThrow();
    expect(fs.readdirSync(f.directory)).toEqual(['config.toml']);
    fs.writeFileSync(f.configPath, '#'.repeat(1024 * 1024 + 1));
    expect(() => installCodexActivity(f.directory, f.helper)).toThrow(/large/);
    fs.writeFileSync(f.configPath, ''); fs.writeFileSync(f.hooksPath, '{');
    expect(() => installCodexActivity(f.directory, f.helper)).toThrow();
    expect(fs.readdirSync(f.directory).sort()).toEqual(['config.toml', 'hooks.json']);
  });

  it('does not touch another launch lock', () => {
    const f = fixture();
    fs.writeFileSync(join(f.directory, '.janet-activity.lock'), 'another launch');
    expect(installCodexActivity(f.directory, f.helper).message).toMatch(/already running/);
    expect(fs.readFileSync(join(f.directory, '.janet-activity.lock'), 'utf8')).toBe('another launch');
    expect(fs.existsSync(f.hooksPath)).toBe(false);
  });

  it('refuses directory links rather than changing their targets', () => {
    const f = fixture();
    const alias = join(f.directory, 'alias');
    const target = join(f.directory, 'target');
    fs.mkdirSync(target);
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => installCodexActivity(alias, f.helper)).toThrow(/symbolic links/);
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('preserves an external edit observed just before replacing a file', () => {
    const f = fixture();
    const write = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((target, data, options) => {
      write(target, data, options);
      if (String(target).startsWith(f.configPath + '.janet-tmp-')) write(f.configPath, '# edited externally\n');
    });
    expect(() => installCodexActivity(f.directory, f.helper)).toThrow(/changed during setup/);
    expect(fs.readFileSync(f.configPath, 'utf8')).toBe('# edited externally\n');
    expect(fs.existsSync(f.hooksPath)).toBe(false);
  });

  it('rolls back an earlier save if the second rename fails', () => {
    const f = fixture();
    fs.writeFileSync(f.hooksPath, '{"hooks":{}}');
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (target === f.configPath) throw new Error('simulated save failure');
      rename(source, target);
    });
    expect(() => installCodexActivity(f.directory, f.helper)).toThrow(/save failure/);
    expect(fs.readFileSync(f.hooksPath, 'utf8')).toBe('{"hooks":{}}');
    expect(fs.readdirSync(f.directory).some(name => name.includes('janet-tmp') || name.endsWith('.lock'))).toBe(false);
  });

  it('does not roll back over a concurrent user edit', () => {
    const f = fixture();
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (target === f.configPath) { fs.writeFileSync(f.hooksPath, '{"description":"user edit"}'); throw new Error('save failed'); }
      rename(source, target);
    });
    expect(() => installCodexActivity(f.directory, f.helper)).toThrow(/save failed/);
    expect(fs.readFileSync(f.hooksPath, 'utf8')).toBe('{"description":"user edit"}');
  });
});
