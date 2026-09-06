import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';
import type { AgentLifecycleEvent } from '../renderer/terminalAwareness';

const EVENTS = ['pre_llm_call', 'on_session_end', 'pre_approval_request', 'post_approval_response', 'on_session_finalize', 'on_session_reset'];
const VALUE_FLAGS = new Set(['-z', '--oneshot', '-m', '--model', '--provider', '--reasoning', '-t', '--toolsets', '-r', '--resume', '-s', '--skills', '--usage-file', '--in', '-q', '--query', '--query-file']);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);

function readSmall(file: string): string {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Hermes configuration is not a regular, bounded file.');
  return fs.readFileSync(file, 'utf8');
}

function rejectLinkedAncestors(file: string): void {
  let ancestor = path.resolve(file);
  while (true) {
    if (fs.lstatSync(ancestor).isSymbolicLink()) throw new Error('Linked Hermes configuration directories cannot be updated automatically.');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
}

/** Mirrors Hermes CLI profile resolution, without importing/executing its Python runtime. */
export function hermesActivityHome(args: string[], env: NodeJS.ProcessEnv): string {
  const native = process.platform === 'win32'
    ? path.join(env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local'), 'hermes')
    : path.join(os.homedir(), '.hermes');
  const supplied = env.HERMES_HOME?.trim();
  if (supplied && !path.isAbsolute(supplied)) throw new Error('Relative HERMES_HOME cannot be updated safely.');
  const home = supplied || native;
  const root = path.basename(path.dirname(home)) === 'profiles' ? path.dirname(path.dirname(home)) : home;
  let selected: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--' || (arg === '--args' && args.slice(0, i).includes('mcp') && args.slice(0, i).includes('add'))) break;
    if (arg === '-p' || arg === '--profile') { selected = args[i + 1]; if (!selected) throw new Error('Missing Hermes profile name.'); break; }
    if (arg.startsWith('--profile=')) { selected = arg.slice(10); break; }
    // ponytail: snapshot of Hermes value flags; extend alongside upstream flags that consume arguments.
    if (VALUE_FLAGS.has(arg) || ((arg === '-c' || arg === '--continue') && args[i + 1] && !args[i + 1].startsWith('-'))) i++;
  }
  if (selected === undefined && supplied && path.basename(path.dirname(home)) === 'profiles') return home;
  if (selected === undefined) {
    // Hermes reads active_profile from its default root, even for a nested HERMES_HOME.
    const relative = path.relative(native, home);
    const stickyRoot = relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) ? native : root;
    const sticky = path.join(stickyRoot, 'active_profile');
    if (fs.existsSync(sticky)) selected = readSmall(sticky).trim() || undefined;
  }
  if (selected === undefined || selected === 'default') return selected === 'default' ? root : home;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(selected)) throw new Error('Invalid Hermes profile name.');
  const profile = path.join(root, 'profiles', selected);
  if (!fs.existsSync(profile) || !fs.statSync(profile).isDirectory() || fs.existsSync(path.join(root, 'profiles', '.deleted', selected))) throw new Error('Hermes profile does not exist.');
  return profile;
}

/** Adds observers, never consent entries or auto-accept settings. Called before normal Hermes launch. */
export function installHermesActivity(helperPath: string, args: string[], env: NodeJS.ProcessEnv): { message?: string } {
  if (args.includes('--safe-mode') || args.includes('--ignore-user-config') || /^(1|true|yes|on)$/i.test(env.HERMES_SAFE_MODE?.trim() || '')) return {};
  if (!path.isAbsolute(helperPath) || /[\x00-\x1f\x7f]/.test(helperPath)) throw new Error('Invalid activity helper path.');
  const file = path.join(hermesActivityHome(args, env), 'config.yaml');
  // Do not create Hermes homes/profiles or interfere with its own first-install setup.
  if (!fs.existsSync(file)) return { message: 'Hermes activity will connect after Hermes setup creates its configuration.' };
  rejectLinkedAncestors(file);
  const original = readSmall(file);
  // PyYAML safe_load uses YAML 1.1 scalars (yes/on/dates), not JSON scalar semantics.
  const config = parseDocument(original, { version: '1.1', keepSourceTokens: true });
  if (config.errors.length || config.warnings.length || !isMap(config.contents)) throw new Error('Hermes configuration must be a valid YAML mapping.');
  if (config.contents.items.some(pair => String(pair.key) === '<<')) throw new Error('Merged Hermes configuration cannot be updated automatically.');
  let hooks = config.get('hooks', true);
  if (hooks !== undefined && !isMap(hooks)) throw new Error('Hermes hooks must be a mapping.');
  if (hooks === undefined) { config.set('hooks', config.createNode({})); hooks = config.get('hooks', true); }
  if (!isMap(hooks)) throw new Error('Hermes hooks must be a mapping.');
  // Updating a shared anchor or merge could also change unrelated config: leave it to the user.
  visit(hooks, (_, node) => {
    if (isAlias(node) || ((isMap(node) || isSeq(node) || isScalar(node)) && node.anchor) || (isMap(node) && node.items.some(pair => String(pair.key) === '<<'))) throw new Error('Aliased Hermes hooks cannot be updated automatically.');
  });
  // Hermes shlex.split uses POSIX quoting even on Windows. Forward slashes avoid backslash consumption.
  const scriptPath = process.platform === 'win32' ? helperPath.replace(/\\/g, '/') : helperPath;
  const command = `node "${scriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" --hermes-hook`;
  let changed = false;
  for (const event of EVENTS) {
    const entries = config.getIn(['hooks', event], true);
    if (entries !== undefined && !isSeq(entries)) throw new Error(`Invalid Hermes ${event} hooks.`);
    if (isSeq(entries) && entries.items.some(entry => isMap(entry) && entry.get('command') === command)) continue;
    if (entries === undefined) config.setIn(['hooks', event], config.createNode([]));
    config.addIn(['hooks', event], config.createNode({ command, timeout: 2 }));
    changed = true;
  }
  if (!changed) return {};
  const content = config.toString({ lineWidth: 0 });
  const suffix = randomUUID();
  const temporary = file + `.janet-${suffix}.tmp`;
  const lock = file + '.janet-activity.lock';
  const descriptor = fs.openSync(lock, 'wx');
  try {
    rejectLinkedAncestors(file);
    if (readSmall(file) !== original) throw new Error('Hermes configuration changed during setup; retry next launch.');
    fs.copyFileSync(file, file + `.janet-backup-${suffix}`, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(temporary, content, { flag: 'wx', mode: fs.statSync(file).mode });
    rejectLinkedAncestors(file);
    if (readSmall(file) !== original) throw new Error('Hermes configuration changed during setup; retry next launch.');
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
  return { message: 'JaneT activity hooks added. Review Hermes’s first-use hook prompts to enable status updates.' };
}

/** Reduces Hermes shell-hook payloads to identifiers/status only; never forwards prompts or commands. */
export function mapHermesActivity(payload: unknown): AgentLifecycleEvent | null {
  if (!record(payload) || !identifier(payload.session_id) || !record(payload.extra)) return null;
  const extra = payload.extra;
  if (extra.parent_session_id || extra.child_session_id || extra.surface === 'smart') return null;
  const base = { version: 1 as const, provider: 'hermes', sessionId: payload.session_id };
  if (payload.hook_event_name === 'on_session_finalize' || payload.hook_event_name === 'on_session_reset') return { ...base, event: 'session.end' };
  if (!identifier(extra.turn_id)) return null;
  const turn = { ...base, turnId: extra.turn_id };
  switch (payload.hook_event_name) {
    case 'pre_llm_call': return { ...turn, event: 'turn.start' };
    case 'pre_approval_request': return { ...turn, event: 'attention.request' };
    case 'post_approval_response':
      return ['once', 'session', 'always', 'deny', 'timeout', 'notify_failed'].includes(String(extra.choice))
        ? { ...turn, event: 'attention.resolve' } : null;
    case 'on_session_end':
      if (extra.interrupted === true) return { ...turn, event: 'turn.end', outcome: 'interrupted' };
      if (extra.failed === true) return { ...turn, event: 'turn.end', outcome: 'failed' };
      if (extra.completed === true && extra.failed === false && extra.interrupted === false) return { ...turn, event: 'turn.end', outcome: 'succeeded' };
      return null;
    default: return null;
  }
}
