import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { decodeAgentOsc } from '../../src/renderer/agentOsc';

const pluginDir = resolve('integrations/hermes-agent-awareness');
const hookNames = [
  'on_session_start',
  'pre_llm_call',
  'pre_approval_request',
  'post_approval_response',
  'on_session_end',
  'on_session_finalize',
];

const probe = String.raw`
import importlib.util
import io
import json
import pathlib
import sys

sys.dont_write_bytecode = True

plugin_dir = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location(
    "janet_hermes_awareness",
    plugin_dir / "__init__.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Context:
    def __init__(self):
        self.hooks = {}
    def register_hook(self, name, callback):
        self.hooks[name] = callback

class Tty(io.StringIO):
    def __init__(self, tty=True):
        super().__init__()
        self.tty = tty
        self.flushes = 0
    def isatty(self):
        return self.tty
    def flush(self):
        self.flushes += 1

class StdoutProxy(io.StringIO):
    def __init__(self, original_stdout):
        super().__init__()
        self.original_stdout = original_stdout
    def isatty(self):
        return self.original_stdout.isatty()

ctx = Context()
module.register(ctx)
real_stdout = sys.stdout
interactive = Tty()
sys.stdout = interactive
ctx.hooks["on_session_start"](session_id="session-1", platform="cli")
ctx.hooks["pre_llm_call"](
    session_id="session-1", turn_id="turn-1", platform="cli",
    parent_session_id="",
)
ctx.hooks["on_session_end"](
    session_id="session-1", turn_id="child-turn", platform="cli",
    completed=True, failed=False, interrupted=False,
)
ctx.hooks["pre_approval_request"](
    surface="cli", session_key="stale-session-key", turn_id="turn-1",
)
ctx.hooks["post_approval_response"](
    surface="cli", session_key="stale-session-key", turn_id="turn-1",
)
ctx.hooks["on_session_end"](
    session_id="session-1", turn_id="turn-1", platform="cli",
    completed=True, failed=False, interrupted=False,
)
ctx.hooks["on_session_start"](session_id="session-1", platform="cli")
ctx.hooks["on_session_finalize"](session_id="session-1", platform="cli")
ctx.hooks["pre_llm_call"](
    session_id="session-2", turn_id="turn-2", platform="cli",
    parent_session_id="",
)
ctx.hooks["on_session_end"](
    session_id="session-2", turn_id="turn-2", platform="cli",
    completed=False, failed=True, interrupted=False,
)
ctx.hooks["pre_llm_call"](
    session_id="session-3", turn_id="turn-3", platform="cli",
    parent_session_id="",
)
ctx.hooks["on_session_end"](
    session_id="session-3", turn_id="turn-3", platform="cli",
    completed=False, failed=False, interrupted=True,
)
ctx.hooks["pre_llm_call"](
    session_id="session-4", turn_id="turn-4", platform="cli",
    parent_session_id="",
)
ctx.hooks["on_session_end"](
    session_id="session-4", turn_id="turn-4", platform="cli",
    completed=False, failed=False, interrupted=False,
)
ctx.hooks["pre_llm_call"](
    session_id="session-5", turn_id="turn-a", platform="cli",
    parent_session_id="",
)
ctx.hooks["pre_llm_call"](
    session_id="session-5", turn_id="turn-b", platform="cli",
    parent_session_id="",
)
ctx.hooks["on_session_end"](
    session_id="session-5", turn_id="turn-a", platform="cli",
    completed=True, failed=False, interrupted=False,
)
ctx.hooks["pre_approval_request"](
    surface="cli", session_key="stale-session-key", turn_id="turn-b",
)
ctx.hooks["on_session_end"](
    session_id="session-5", turn_id="turn-b", platform="cli",
    completed=True, failed=False, interrupted=False,
)
ctx.hooks["on_session_finalize"](session_id="session-5", platform="cli")

silent = Tty()
sys.stdout = silent
ctx.hooks["on_session_start"](session_id="gateway", platform="telegram")
ctx.hooks["pre_llm_call"](session_id="subagent", turn_id="t", platform="cli", parent_session_id="parent")
ctx.hooks["pre_approval_request"](surface="smart", session_key="session-3")
ctx.hooks["post_approval_response"](surface="smart", session_key="session-3")
ctx.hooks["pre_approval_request"](
    surface="cli", session_key="session-3", turn_id="subagent-turn",
)
ctx.hooks["on_session_end"](session_id="gateway", platform="gateway", completed=True)
ctx.hooks["on_session_finalize"](session_id="gateway", platform="gateway")
ctx.hooks["on_session_start"](session_id="x" * 257, platform="cli")

headless = Tty(False)
sys.stdout = headless
ctx.hooks["on_session_start"](session_id="headless", platform="cli")

proxied_tty = Tty()
proxy = StdoutProxy(proxied_tty)
sys.stdout = proxy
ctx.hooks["on_session_start"](session_id="proxied", platform="cli")

tui = Tty()
def write_tui(data):
    tui.write(data)
    tui.flush()
module._write_terminal = write_tui
tui_protocol = Tty()
sys.stdout = tui_protocol
ctx.hooks["on_session_start"](session_id="tui-session", platform="tui")
ctx.hooks["pre_llm_call"](
    session_id="tui-session", turn_id="tui-turn", platform="tui",
    parent_session_id="",
)
ctx.hooks["pre_approval_request"](
    surface="gateway", session_key="tui-session", turn_id="tui-turn",
)
ctx.hooks["post_approval_response"](
    surface="gateway", session_key="tui-session", turn_id="tui-turn",
)
ctx.hooks["on_session_end"](
    session_id="tui-session", turn_id="tui-turn", platform="tui",
    completed=True, failed=False, interrupted=False,
)
ctx.hooks["on_session_finalize"](session_id="tui-session", platform="tui")

sys.stdout = real_stdout
print(json.dumps({
    "hooks": sorted(ctx.hooks),
    "interactive": interactive.getvalue(),
    "flushes": interactive.flushes,
    "silent": silent.getvalue(),
    "headless": headless.getvalue(),
    "proxied": proxied_tty.getvalue(),
    "proxy": proxy.getvalue(),
    "tui": tui.getvalue(),
    "tui_protocol": tui_protocol.getvalue(),
}))
`;

function eventsFrom(output: string) {
  return [...output.matchAll(/\u001b\]777;([^\u001b]*)\u001b\\/g)].map((match) => {
    const decoded = decodeAgentOsc(match[1]);
    expect(decoded.recognized).toBe(true);
    expect(decoded.event).toBeDefined();
    return decoded.event!;
  });
}

describe('Hermes agent awareness plugin', () => {
  it('registers the official hooks and emits only bounded interactive CLI lifecycle events', () => {
    const manifest = readFileSync(resolve(pluginDir, 'plugin.yaml'), 'utf8');
    for (const hook of hookNames) expect(manifest).toContain(`  - ${hook}`);

    const result = spawnSync('python', ['-c', probe, pluginDir], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const observed = JSON.parse(result.stdout);

    expect(observed.hooks).toEqual([...hookNames].sort());
    expect(eventsFrom(observed.interactive)).toEqual([
      { version: 1, provider: 'hermes', event: 'session.start', sessionId: 'session-1' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session-1', turnId: 'turn-1' },
      { version: 1, provider: 'hermes', event: 'attention.request', sessionId: 'session-1', turnId: 'turn-1' },
      { version: 1, provider: 'hermes', event: 'attention.resolve', sessionId: 'session-1', turnId: 'turn-1' },
      { version: 1, provider: 'hermes', event: 'turn.end', sessionId: 'session-1', turnId: 'turn-1', outcome: 'succeeded' },
      { version: 1, provider: 'hermes', event: 'session.end', sessionId: 'session-1' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session-2', turnId: 'turn-2' },
      { version: 1, provider: 'hermes', event: 'turn.end', sessionId: 'session-2', turnId: 'turn-2', outcome: 'failed' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session-3', turnId: 'turn-3' },
      { version: 1, provider: 'hermes', event: 'turn.end', sessionId: 'session-3', turnId: 'turn-3', outcome: 'interrupted' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session-4', turnId: 'turn-4' },
      { version: 1, provider: 'hermes', event: 'turn.end', sessionId: 'session-4', turnId: 'turn-4', outcome: 'interrupted' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session-5', turnId: 'turn-a' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'session-5', turnId: 'turn-b' },
      { version: 1, provider: 'hermes', event: 'attention.request', sessionId: 'session-5', turnId: 'turn-b' },
      { version: 1, provider: 'hermes', event: 'turn.end', sessionId: 'session-5', turnId: 'turn-b', outcome: 'succeeded' },
      { version: 1, provider: 'hermes', event: 'session.end', sessionId: 'session-5' },
    ]);
    expect(observed.flushes).toBe(17);
    expect(observed.silent).toBe('');
    expect(observed.headless).toBe('');
    expect(eventsFrom(observed.proxied)).toEqual([
      { version: 1, provider: 'hermes', event: 'session.start', sessionId: 'proxied' },
    ]);
    expect(observed.proxy).toBe('');
    expect(eventsFrom(observed.tui)).toEqual([
      { version: 1, provider: 'hermes', event: 'session.start', sessionId: 'tui-session' },
      { version: 1, provider: 'hermes', event: 'turn.start', sessionId: 'tui-session', turnId: 'tui-turn' },
      { version: 1, provider: 'hermes', event: 'attention.request', sessionId: 'tui-session', turnId: 'tui-turn' },
      { version: 1, provider: 'hermes', event: 'attention.resolve', sessionId: 'tui-session', turnId: 'tui-turn' },
      { version: 1, provider: 'hermes', event: 'turn.end', sessionId: 'tui-session', turnId: 'tui-turn', outcome: 'succeeded' },
      { version: 1, provider: 'hermes', event: 'session.end', sessionId: 'tui-session' },
    ]);
    expect(observed.tui_protocol).toBe('');
  });
});
