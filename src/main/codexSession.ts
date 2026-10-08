import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'smol-toml';
import { read } from './codexActivitySetup';
import { encodeNotify, withoutJanetNotify } from './codexNotify';

const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Interrupt'];
// ponytail: snapshot of Codex CLI 0.159 root options; extend alongside upstream flags that take a value.
const VALUE_FLAGS = new Set(['-c', '--config', '--enable', '--disable', '--remote', '--remote-auth-token-env', '-i', '--image',
  '-m', '--model', '--local-provider', '-p', '--profile', '-s', '--sandbox', '-C', '--cd', '--add-dir', '-a', '--ask-for-approval']);
// Subcommands that run agent turns in this terminal; every other subcommand runs unchanged.
const SESSION_SUBCOMMANDS = new Set(['resume', 'fork', 'exec', 'e', 'review']);
const SUBCOMMANDS = new Set(['agents', 'login', 'logout', 'mcp', 'plugin', 'app-server', 'remote-control', 'app', 'completion',
  'update', 'doctor', 'sandbox', 'debug', 'apply', 'a', 'queue', 'archive', 'delete', 'migrate-rollouts', 'unarchive', 'cloud',
  'exec-server', 'features', 'help']);

export type CodexLaunch = { decision: 'skip' } | { decision: 'inject' | 'conflict'; config: string[] };

/** The first positional argument, skipping root option values. */
function subcommand(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') return undefined;
    if (VALUE_FLAGS.has(arg)) { i++; continue; }
    if (!arg.startsWith('-')) return arg;
  }
  return undefined;
}

function overridesNotify(args: string[]): boolean {
  return args.some((arg, index) => /^(?:-c=?|--config=)\s*notify\s*=/.test(arg)
    || (['-c', '--config'].includes(args[index - 1]) && /^\s*notify\s*=/.test(arg)));
}

function selectedProfile(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') break;
    if (args[i] === '-p' || args[i] === '--profile') return args[i + 1];
    if (args[i].startsWith('--profile=')) return args[i].slice(10);
    if (VALUE_FLAGS.has(args[i])) i++;
  }
  return undefined;
}

/** The notifier Codex would run for this launch, minus any JaneT forwarder from an older install. */
export function effectiveNotify(codexHome: string, args: string[]): string[] {
  const root = parse(read(path.join(codexHome, 'config.toml')) ?? '') as Record<string, unknown>;
  const profile = selectedProfile(args) ?? (typeof root.profile === 'string' ? root.profile : undefined);
  if (profile !== undefined) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(profile) || profile.startsWith('.')) throw new Error('Invalid Codex profile name.');
    const file = read(path.join(codexHome, `${profile}.config.toml`));
    if (file !== undefined) {
      const overlay = parse(file) as Record<string, unknown>;
      if (Object.hasOwn(overlay, 'notify')) return withoutJanetNotify(overlay.notify);
    }
    const profiles = root.profiles as Record<string, Record<string, unknown>> | undefined;
    const inline = profiles && typeof profiles === 'object' ? profiles[profile] : undefined;
    if (inline && typeof inline === 'object' && Object.hasOwn(inline, 'notify')) return withoutJanetNotify(inline.notify);
  }
  return Object.hasOwn(root, 'notify') ? withoutJanetNotify(root.notify) : [];
}

/**
 * A single-line TOML literal string. Values never contain a double quote: Windows PowerShell 5.1
 * strips those from native command arguments. Multi-line literal quotes allow embedded apostrophes.
 */
function tomlLiteral(value: string): string {
  if (/["\x00-\x1f\x7f]/.test(value) || value.includes("'''")) throw new Error('Path cannot be passed to Codex safely.');
  return value.includes("'") ? `'''${value}'''` : `'${value}'`;
}

export function codexHookCommand(helperPath: string, platform = process.platform): string {
  const script = helperPath.replace(/\\/g, '/');
  return platform === 'win32'
    ? `node '${script.replace(/'/g, "''")}' --codex-hook`
    : `node '${script.replace(/'/g, "'\\''")}' --codex-hook`;
}

/**
 * Session-only `-c` values: JaneT's hooks plus a notify forwarder that still runs the user's notifier.
 * Codex records hook trust itself, keyed to these session flags; nothing is written to the Codex home.
 */
export function codexLaunch(args: string[], helperPath: string, codexHome: string): CodexLaunch {
  if (args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) return { decision: 'skip' };
  const command = subcommand(args);
  if (command !== undefined && SUBCOMMANDS.has(command) && !SESSION_SUBCOMMANDS.has(command)) return { decision: 'skip' };
  // Windows reports a file used as a directory as missing; fail clearly instead of ignoring it.
  if (fs.existsSync(codexHome) && !fs.statSync(codexHome).isDirectory()) throw Object.assign(new Error('CODEX_HOME is not a directory.'), { code: 'ENOTDIR' });
  const hook = `[{hooks=[{type='command',command=${tomlLiteral(codexHookCommand(helperPath))},timeout=2,statusMessage='JaneT activity'}]}]`;
  const notify = ['node', helperPath.replace(/\\/g, '/'), '--codex-notify-forward-b64', encodeNotify(effectiveNotify(codexHome, args))];
  return {
    decision: overridesNotify(args) ? 'conflict' : 'inject',
    config: [...EVENTS.map(event => `hooks.${event}=${hook}`), `notify=[${notify.map(tomlLiteral).join(',')}]`],
  };
}
