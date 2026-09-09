import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { parse, stringify, type TomlTableWithoutBigInt } from 'smol-toml';
import { connectCodexNotify } from './codexNotify';

const LIMIT = 1024 * 1024;
const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Interrupt'];

/** Resolve only CLI options we understand; unknown syntax keeps normal Codex onboarding. */
export function codexLaunchDirectory(args: string[], cwd: string): string | undefined {
  try {
    const options: Record<string, { type: 'string' | 'boolean'; short?: string; multiple?: boolean }> = {};
    for (const [name, short] of [['cd', 'C'], ['config', 'c'], ['image', 'i'], ['model', 'm'], ['profile', 'p'],
      ['sandbox', 's'], ['ask-for-approval', 'a'], ['local-provider'], ['add-dir'], ['enable'], ['disable'], ['remote'], ['remote-auth-token-env']]) {
      options[name] = { type: 'string', ...(short ? { short } : {}), multiple: name !== 'cd' };
    }
    for (const name of ['oss', 'search', 'no-alt-screen', 'strict-config', 'approve-for-me', 'last', 'all',
      'dangerously-bypass-approvals-and-sandbox', 'dangerously-bypass-hook-trust']) options[name] = { type: 'boolean' };
    const { values, positionals } = parseArgs({ args, options, allowPositionals: true });
    if (values.remote || (positionals.length && !['resume', 'fork'].includes(positionals[0]))) return undefined;
    return fs.realpathSync(path.resolve(cwd, typeof values.cd === 'string' ? values.cd : '.'));
  } catch { return undefined; }
}

function trustDirectory(source: string, directory: string): string {
  const expected = parse(source);
  // Keep explicit existing trust decisions, including "untrusted".
  const projects = expected.projects as TomlTableWithoutBigInt | undefined;
  if (projects && Object.hasOwn(projects, directory)) return source;
  const entry = { trust_level: 'trusted' };
  const next = source + '\n' + stringify({ projects: { [directory]: entry } });
  expected.projects = { ...projects, [directory]: entry };
  if (!isDeepStrictEqual(parse(next), expected)) throw new Error('Cannot safely save Codex directory trust.');
  return next;
}

function rejectLinks(target: string): void {
  for (let current = target; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Codex setup will not modify symbolic links.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}

function read(target: string): string | undefined {
  rejectLinks(target);
  let descriptor: number;
  try { descriptor = fs.openSync(target, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('Codex configuration is too large or is not a regular file.');
    const buffer = Buffer.alloc(LIMIT + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(descriptor, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > LIMIT) throw new Error('Codex configuration is too large.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
  } finally { fs.closeSync(descriptor); }
}

/** Automatic setup is additive; Codex itself still owns hook trust and feature policy. */
export function installCodexActivity(directory: string, helperPath: string, projectDirectory?: string): { message?: string } {
  if (!path.isAbsolute(directory) || !path.isAbsolute(helperPath) || /[\x00-\x1f\x7f]/.test(directory + helperPath)) {
    throw new Error('Codex setup requires absolute, valid paths.');
  }
  rejectLinks(directory);
  if (projectDirectory !== undefined) {
    if (!path.isAbsolute(projectDirectory)) throw new Error('Codex project trust requires an absolute directory.');
    projectDirectory = fs.realpathSync(projectDirectory);
    if (!fs.statSync(projectDirectory).isDirectory()) throw new Error('Codex project trust requires a directory.');
  }
  fs.mkdirSync(directory, { recursive: true });
  const lockPath = path.join(directory, '.janet-activity.lock');
  let lock: number;
  const deadline = Date.now() + (projectDirectory ? 5000 : 0);
  for (;;) {
    try { lock = fs.openSync(lockPath, 'wx', 0o600); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) return { message: 'JaneT activity setup is already running or its lock remains from an interrupted setup. Codex will open unchanged.' };
      // This runs in the standalone setup helper, never the Electron UI process.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  const temporary: string[] = [];
  try {
    const configPath = path.join(directory, 'config.toml');
    const hooksPath = path.join(directory, 'hooks.json');
    const config = read(configPath);
    const originalHooks = read(hooksPath);
    let nextConfig = connectCodexNotify(config ?? '', helperPath, true);
    if (projectDirectory) nextConfig = trustDirectory(nextConfig, projectDirectory);
    const profiles = fs.readdirSync(directory).filter(name => name.endsWith('.config.toml'));
    if (profiles.length > 256) throw new Error('Too many Codex profiles to inspect safely.');
    const changes: { target: string; original: string | undefined; next: string }[] = [];
    for (const name of profiles) {
      const target = path.join(directory, name);
      const original = read(target);
      const next = connectCodexNotify(original ?? '', helperPath, false);
      if (next !== original) changes.push({ target, original, next });
    }
    const data = originalHooks === undefined ? {} : JSON.parse(originalHooks);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Codex hooks configuration.');
    const hooks = data.hooks ?? {};
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error('Invalid Codex hooks configuration.');
    for (const groups of Object.values(hooks)) {
      if (!Array.isArray(groups) || groups.some(group => !group || typeof group !== 'object' ||
        !Array.isArray(group.hooks) || group.hooks.some((hook: unknown) => !hook || typeof hook !== 'object' || Array.isArray(hook)))) {
        throw new Error('Invalid Codex hooks configuration.');
      }
    }
    const script = helperPath.replace(/\\/g, '/');
    const command = process.platform === 'win32'
      ? `node '${script.replace(/'/g, "''")}' --codex-hook`
      : `node '${script.replace(/'/g, "'\\''")}' --codex-hook`;
    let changedHooks = false;
    for (const name of EVENTS) {
      if (hooks[name] !== undefined && !Array.isArray(hooks[name])) throw new Error(`Invalid ${name} hooks.`);
      const groups = hooks[name] ?? [];
      if (!groups.some((group: { hooks?: { command?: string }[]; matcher?: string }) =>
        group && !group.matcher && Array.isArray(group.hooks) && group.hooks.some(hook => hook?.command === command))) {
        hooks[name] = [...groups, { hooks: [{ type: 'command', command, timeout: 2, statusMessage: 'JaneT activity' }] }];
        changedHooks = true;
      }
    }
    data.hooks = hooks;
    if (changedHooks) changes.push({ target: hooksPath, original: originalHooks, next: JSON.stringify(data, null, 2) + '\n' });
    if (nextConfig !== config) changes.push({ target: configPath, original: config, next: nextConfig });
    if (changes.some(change => Buffer.byteLength(change.next, 'utf8') > LIMIT)) throw new Error('Updated Codex configuration is too large.');
    const suffix = `.janet-backup-${Date.now()}-${randomUUID()}`;
    const committed: typeof changes = [];
    try {
      for (const change of changes) {
        if (read(change.target) !== change.original) throw new Error('Codex configuration changed during setup; retry on the next launch.');
        if (change.original !== undefined) fs.writeFileSync(change.target + suffix, change.original, { flag: 'wx', mode: 0o600 });
        const temp = change.target + '.janet-tmp-' + randomUUID();
        fs.writeFileSync(temp, change.next, { flag: 'wx', mode: 0o600 });
        temporary.push(temp);
        // The lock serializes JaneT launches; recheck external editor changes before each replace.
        if (read(change.target) !== change.original) throw new Error('Codex configuration changed during setup; retry on the next launch.');
        fs.renameSync(temp, change.target);
        committed.push(change);
      }
    } catch (error) {
      for (const change of committed.reverse()) {
        // Never roll back over an external edit made after our own save.
        if (read(change.target) !== change.next) continue;
        if (change.original === undefined) fs.unlinkSync(change.target);
        else {
          const temp = change.target + '.janet-tmp-' + randomUUID();
          fs.writeFileSync(temp, change.original, { flag: 'wx', mode: 0o600 });
          temporary.push(temp);
          if (read(change.target) === change.next) fs.renameSync(temp, change.target);
        }
      }
      throw error;
    }
    return {};
  } finally {
    try {
      for (const temp of temporary) { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
  }
}
