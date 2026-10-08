import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { disconnectCodexNotify } from './codexNotify';

const LIMIT = 1024 * 1024;

/** Hooks JaneT's persistent installer wrote (any JaneT profile or install path). */
export function isJanetCodexHook(hook: { command?: unknown; statusMessage?: unknown }): boolean {
  return hook.statusMessage === 'JaneT activity' && typeof hook.command === 'string'
    // Path quoting: PowerShell doubles an apostrophe, POSIX shells close and escape it.
    && /^node '(?:[^']|''|'\\'')*[\\/]agent-cli\.cjs' --codex-hook$/.test(hook.command);
}

function rejectLinks(target: string): void {
  for (let current = target; ; current = path.dirname(current)) {
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Codex setup will not modify symbolic links.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}

export function read(target: string): string | undefined {
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

const SHARING_VIOLATIONS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Replaces `target` with `temp` while `target` still holds `expected`. On Windows a concurrent
 * launch's unlocked read briefly blocks the replace (EPERM/EACCES/EBUSY), so retry until the
 * deadline, rechecking for external edits before every attempt. Returns false after such an edit.
 */
function replaceIfUnchanged(temp: string, target: string, expected: string | undefined, deadline: number): boolean {
  for (;;) {
    if (read(target) !== expected) return false;
    try { fs.renameSync(temp, target); return true; }
    catch (error) {
      if (process.platform !== 'win32' || !SHARING_VIOLATIONS.has((error as NodeJS.ErrnoException).code ?? '') || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function profileFiles(directory: string): string[] {
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.config.toml') && name !== 'config.toml');
  if (names.length > 256) throw new Error('Too many Codex profiles to inspect safely.');
  return names.map(name => path.join(directory, name));
}

/** hooks.json text without JaneT entries, or undefined when there is nothing to remove. */
function withoutJanetHooks(text: string): string | undefined {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Codex hooks configuration.');
  const hooks = data.hooks;
  if (hooks === undefined) return undefined;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error('Invalid Codex hooks configuration.');
  let changed = false;
  for (const [name, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || groups.some(group => !group || typeof group !== 'object' || !Array.isArray(group.hooks)
      || group.hooks.some((hook: unknown) => !hook || typeof hook !== 'object' || Array.isArray(hook)))) throw new Error('Invalid Codex hooks configuration.');
    const kept = (groups as { hooks: Record<string, unknown>[] }[]).flatMap(group => {
      const retained = group.hooks.filter(hook => !isJanetCodexHook(hook));
      if (retained.length === group.hooks.length) return [group];
      changed = true;
      return retained.length ? [{ ...group, hooks: retained }] : [];
    });
    // Drop an event only when removing JaneT emptied it; a user's own empty list stays.
    if (kept.length === 0 && groups.length > 0) delete hooks[name];
    else hooks[name] = kept;
  }
  return changed ? JSON.stringify(data, null, 2) + '\n' : undefined;
}

function codexCleanupNeeded(directory: string): boolean {
  const hooks = read(path.join(directory, 'hooks.json'));
  if (hooks !== undefined && withoutJanetHooks(hooks) !== undefined) return true;
  return [path.join(directory, 'config.toml'), ...profileFiles(directory)].some(target => {
    const source = read(target);
    return source !== undefined && disconnectCodexNotify(source) !== source;
  });
}

/**
 * Removes what JaneT's former persistent installer added to a Codex home: its hooks.json entries and
 * notify forwarders (root, inline profiles and `<name>.config.toml` profiles). Existing user hooks,
 * notifiers and Codex-owned trust records stay. Nothing is created; reads only when nothing matches.
 */
export function removeCodexActivity(directory: string): { changed: string[]; message?: string } {
  if (!path.isAbsolute(directory) || /[\x00-\x1f\x7f]/.test(directory)) throw new Error('Codex cleanup requires an absolute, valid path.');
  rejectLinks(directory);
  if (!fs.existsSync(directory)) return { changed: [] };
  // Cheap read-only check first: ordinary launches must not take a lock or write anything.
  if (!codexCleanupNeeded(directory)) return { changed: [] };
  const lockPath = path.join(directory, '.janet-activity.lock');
  let lock: number;
  const deadline = Date.now() + 5000;
  for (;;) {
    try { lock = fs.openSync(lockPath, 'wx', 0o600); break; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can report EPERM while another process owns the exclusive
      // create/open window. This is a private lock path and the wait is
      // bounded; unrelated permission failures still surface when no wait is
      // allowed.
      if (code !== 'EEXIST' && code !== 'EPERM') throw error;
      if (code === 'EPERM' && Date.now() >= deadline) throw error;
      if (Date.now() >= deadline) return { changed: [], message: 'Another JaneT cleanup is running, or its lock remains from an interrupted one. Old Codex entries were left in place.' };
      // This runs in the standalone setup helper, never the Electron UI process.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  const temporary: string[] = [];
  try {
    const configPath = path.join(directory, 'config.toml');
    const hooksPath = path.join(directory, 'hooks.json');
    const changes: { target: string; original: string | undefined; next: string }[] = [];
    for (const target of [configPath, ...profileFiles(directory)]) {
      const original = read(target);
      if (original === undefined) continue;
      const next = disconnectCodexNotify(original);
      if (next !== original) changes.push({ target, original, next });
    }
    const originalHooks = read(hooksPath);
    const nextHooks = originalHooks === undefined ? undefined : withoutJanetHooks(originalHooks);
    if (nextHooks !== undefined) changes.push({ target: hooksPath, original: originalHooks, next: nextHooks });
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
        if (!replaceIfUnchanged(temp, change.target, change.original, Date.now() + 2000)) throw new Error('Codex configuration changed during setup; retry on the next launch.');
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
          replaceIfUnchanged(temp, change.target, change.next, Date.now() + 2000);
        }
      }
      throw error;
    }
    return { changed: committed.map(change => change.target) };
  } finally {
    try {
      for (const temp of temporary) { try { fs.unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
    } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
  }
}
