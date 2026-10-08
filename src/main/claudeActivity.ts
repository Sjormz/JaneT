import * as path from 'node:path';
import type { AgentLifecycleEvent } from '../renderer/terminalAwareness';

/** Written next to the helper and passed to `claude --settings`; never merged into ~/.claude. */
export const CLAUDE_SETTINGS_FILE = 'claude-settings.json';

const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure'];
// ponytail: snapshot of Claude Code 2.1.289 subcommands; extend alongside upstream additions.
const SUBCOMMANDS = new Set(['agents', 'attach', 'auth', 'auto-mode', 'doctor', 'gateway', 'import', 'install', 'logs',
  'mcp', 'plugin', 'plugins', 'purge', 'respawn', 'rm', 'setup-token', 'stop', 'kill', 'ultrareview', 'update', 'upgrade']);
const ATTENTION_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog']);

export function claudeSettingsPath(helperPath: string): string {
  return path.join(path.dirname(helperPath), CLAUDE_SETTINGS_FILE);
}

/** Session-only settings. Exec form avoids Git Bash/PowerShell quoting of the helper path. */
export function claudeSettings(helperPath: string): string {
  const hook = { type: 'command', command: 'node', args: [helperPath, '--claude-hook'], timeout: 2 };
  return JSON.stringify({ hooks: Object.fromEntries(EVENTS.map(name => [name, [{ hooks: [hook] }]])) }, null, 2) + '\n';
}

/**
 * Whether this launch is an interactive/print session that should receive JaneT's hooks.
 * Help/version, management subcommands and background sessions run unchanged; a user
 * `--settings` is never overridden.
 */
export function claudeLaunchDecision(args: string[]): 'inject' | 'skip' | 'conflict' {
  if (args.some(arg => arg === '--settings' || arg.startsWith('--settings='))) return 'conflict';
  if (SUBCOMMANDS.has(args[0] ?? '')) return 'skip';
  if (args.some(arg => ['--help', '-h', '--version', '-v', '--bg', '--background'].includes(arg))) return 'skip';
  return 'inject';
}

/** Reduces a Claude Code hook payload to lifecycle identifiers; prompts, tools and transcripts never leave. */
export function claudeActivity(payload: unknown): AgentLifecycleEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  // Subagent and background-agent hooks share the session id; they never own the parent turn.
  if (p.agent_id !== undefined) return null;
  const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
  if (!id(p.session_id) || typeof p.hook_event_name !== 'string') return null;
  const base = { version: 1 as const, provider: 'claude', sessionId: p.session_id };
  if (p.hook_event_name === 'SessionStart') return { ...base, event: 'session.start' };
  if (p.hook_event_name === 'SessionEnd') return { ...base, event: 'session.end' };
  // prompt_id (Claude Code 2.1.196+) identifies the user turn every later hook belongs to.
  if (!id(p.prompt_id)) return null;
  const turn = { ...base, turnId: p.prompt_id };
  switch (p.hook_event_name) {
    case 'UserPromptSubmit': return { ...turn, event: 'turn.start' };
    case 'PreToolUse': case 'PostToolUse': case 'PostToolUseFailure': case 'PermissionDenied':
      return { ...turn, event: 'attention.resolve' };
    case 'PermissionRequest': return { ...turn, event: 'attention.request' };
    case 'Notification':
      return typeof p.notification_type === 'string' && ATTENTION_NOTIFICATIONS.has(p.notification_type)
        ? { ...turn, event: 'attention.request' } : null;
    case 'Stop': return { ...turn, event: 'turn.end', outcome: p.stop_reason === 'user_stop' ? 'interrupted' : 'succeeded' };
    case 'StopFailure': return { ...turn, event: 'turn.end', outcome: 'failed' };
    default: return null;
  }
}
