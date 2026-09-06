# Terminal and project activity

JaneT uses explicit shell/agent lifecycle events, never silence or screen scraping.

- Green: shell/agent ready. Green with `new`: an unseen result.
- Yellow: a foreground command or agent turn is running. Project rows include the busy terminal count.
- Amber diamond: the agent requests attention. This can precede a native approval dialog; it does not mean JaneT grants approval.
- Red: unseen failure. Muted: no integration, exited or disconnected. Hover/accessible labels explain each state.
- Unseen results remain while other terminals run. Visiting a project acknowledges its results; returning focus acknowledges the currently visible project. Indicators are live session state, not persisted claims about restarted processes.

## Codex CLI

Requires Node.js on PATH and a Codex release supporting the documented hooks and `notify` callback. Tested helper/schema against the current official documentation; installed CLI version is 0.153.4. No model-backed turn was run as part of verification.

1. Open a new JaneT local terminal and type `codex` normally. There is no separate Connect button.
2. Before launch, JaneT appends its observers to `hooks.json` and connects `notify`, preserving existing root/profile notification commands through a forwarding callback. Unrelated configuration text stays intact, and changed existing files receive exclusive backups. Subsequent launches are idempotent.
3. Review/trust the new hooks using Codex `/hooks`. Administrator policy or disabled hooks still takes precedence; JaneT does not bypass either.
4. After an app update/restart, recreate old terminals to receive the launch integration. Resume/fork arguments, normal TTY interaction, piped PowerShell input and CLI exit status are retained. Help/version requests do not install anything.

Mapping: SessionStart → ready; UserPromptSubmit → busy; PermissionRequest → attention; Pre/PostToolUse → running; Interrupt → interrupted; SessionEnd → session removed. The `notify` event `agent-turn-complete` supplies the finished signal. `Stop` is deliberately not used: another Stop hook can continue the turn. Subagent hooks are not installed. Duplicate terminal completion is suppressed when an agent integration already owns that command.

The helper sends only bounded event/session/turn identifiers and setup availability over a loopback-only per-terminal capability URL. Prompt text, tool input/output, transcript paths and assistant messages never go to JaneT. Closing the terminal revokes the URL. No approval decisions are returned by the helper.

### Existing notify handler

JaneT automatically wraps the existing command without a shell, retains every argument, and forwards Codex's original JSON payload unchanged to that command. This forwarding also runs outside JaneT, where no activity is sent to the app. A failing notifier cannot suppress JaneT's completion event. Root, legacy inline profiles and profile-file handlers are supported, including migration of older JaneT callbacks without duplicate forwarding.

A user-supplied `-c notify=...` takes precedence; JaneT reports **Activity tracking incomplete** for that launch instead of a reliable busy count. Setup failures use the same fallback. Hook input is processed when its single JSON object is complete, without requiring stdin EOF. Do not put `notify` in project config: Codex ignores it there. Missing/untrusted lifecycle hooks or later runtime delivery failures still require diagnosis; setup success alone is not proof of event delivery.

### Remove integration

Remove the JaneT command entries from the agent's hooks configuration. For a forwarded `notify`, restore the original argv array encoded in its fourth element; if that array is empty, remove the JaneT notification setting. Preserve unrelated hooks. Backups are available as `*.janet-backup-*`; restoring an old backup wholesale also loses subsequent edits, so compare first. Normal launches inside JaneT will reconnect; use the executable's full path (or your own alias/function) to bypass the launch wrapper. Outside JaneT only the preserved notifier runs.

## Hermes CLI and TUI

Type `hermes` or `hermes --tui` normally. JaneT adds observer hooks to the selected profile's existing `config.yaml`, preserving unrelated values/comments and making a backup. It respects `HERMES_HOME`, explicit `--profile`/`-p`, sticky profiles and the native Windows data root. It does not create missing Hermes profiles/configuration or alter safe-mode, plugin enablement or hook-consent policy. Accept only the hook prompts you have reviewed; no `--accept-hooks` flag is injected.

`pre_llm_call` starts a top-level turn; canonical `on_session_end` supplies success/failure/interruption. This event is turn finalization, not merely closing Hermes. Approval hooks report attention only with real session/turn IDs; automated smart approval and ambiguous legacy events are ignored. Child turn completion cannot finish the parent's status. Existing Hermes graphics handling is retained.

## Launch and platform limits

Automatic launch wrappers cover PowerShell, Bash, Zsh and Fish. Existing aliases/functions are not overwritten. Explicit binary paths, `command codex`, nested shells, `cmd.exe`, SSH, WSL and containers do not automatically receive the launch setup. Node must be on PATH. Setup failure does not prevent the agent from launching. A stale setup lock is left intact and reported rather than guessed safe to delete.

The app bundles the helper, copies it to a stable app-data path, and uses the existing per-terminal loopback capability. It never sends prompts, transcript paths, tool inputs, assistant messages or approval decisions to JaneT; only the pre-existing notifier receives its original payload. Session/turn matching rejects unrelated completions; same-session Codex compaction preserves the current turn.

## Other agent CLIs researched

| CLI | Verified extension route | Current JaneT support |
| --- | --- | --- |
| Claude Code | Additive session-only `--plugin-dir`; lifecycle hooks | Researched, not installed. `Stop` can request continuation, so it is not a definitive success signal. |
| OpenCode | Additive plugin configuration; native session status/idle/error and permissions | Researched, not installed. Requires explicit parent/child and multi-session routing tests. |
| Gemini CLI | BeforeAgent/AfterAgent/notification hooks | Researched, not installed. No verified additive ephemeral loader; system-setting replacements would override policy. AfterAgent can retry. |
| Copilot CLI | Dedicated user hooks file | Researched, not installed. Persistent setup/consent and final-versus-continuation semantics need a separate adapter. |

Primary research: [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Claude hooks](https://code.claude.com/docs/en/hooks), [OpenCode plugins](https://opencode.ai/docs/plugins/), [OpenCode configuration](https://opencode.ai/docs/config/), [Gemini hooks](https://geminicli.com/docs/hooks/reference/), [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference), [Hermes hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/).

## Command notifications

Settings still control the threshold and unfocused-only desktop notification policy. Timing uses a monotonic clock; signed Windows exit codes are accepted. Missing command text no longer prevents completion tracking. A TUI's alternate-screen markers do not cancel the outer shell command. Notification contents exclude command/output text.

Clicking a current-session toast opens its project and terminal. Stale targets are ignored; after an application restart an old toast opens JaneT but cannot resurrect an ended terminal. Windows activation uses the native activation callback. **Check notification delivery** in Settings reports native failures; `show()` returning is not proof the OS displayed a toast. OS permissions and Do Not Disturb remain authoritative.

## Honest boundaries

### Real Codex regression (opt-in)

`node scripts/test-codex-activity.mjs <isolated-test-root>` runs the installed Codex TUI, not synthetic hook payloads. It serves deterministic Responses SSE on localhost, types two prompts, and asserts real callbacks drive JaneT's bridge and renderer reducer through Ready → Running → Ready twice. No OpenAI credentials or paid model requests are used. Set `JANET_CODEX_TEST_BINARY` to test another installed CLI binary.

The root must be a disposable `%TEMP%/janet-real-codex-*` directory with `home` (CODEX_HOME) and an empty `work` directory. Its config must use `model="test-model"`, `model_provider="local_test"`, enabled hooks, and a `model_providers.local_test` Responses provider with a localhost base URL. Build JaneT first and run its bundled helper with `--setup-codex` in that isolated CODEX_HOME. Complete normal Codex directory/hook/sandbox review in that profile once; the regression refuses review screens instead of automatically accepting permissions. Never point it at your real Codex home. The runner overrides only the local provider URL per invocation and uses read-only sandbox mode.

Set `JANET_CODEX_TEST_DISABLE_NOTIFY=1` for the negative control: the test **must fail** waiting for completion while state remains Running. Clear that variable for normal runs. On Windows Codex 0.153.4, both the positive two-turn run and this expected-failure control were verified. This covers the real CLI, helper, transport and reducer; the separate Electron test covers rendering, and a user-run live session confirmed Ready after restart.

For delivery diagnosis, start JaneT with `JANET_ACTIVITY_DIAGNOSTICS` pointing to a disposable log file. This is off by default. The helper and bridge record timestamps, stage, hashed IDs and HTTP status only; no payloads, prompts, responses, capability URLs or raw IDs. Logging stops at approximately 64 KiB and failures never block terminal operation. Unset the variable on a subsequent launch to disable it.

- Background/detached jobs are not individual foreground commands. Use a foreground `wait`/job-wait command if you need a shell completion notification, or an explicit agent lifecycle adapter. No background-process polling is installed.
- A long-lived uninstrumented TUI is a running shell command, not an AI task. Hermes hooks must be accepted and enabled; its open process alone cannot identify response completion.
- Local PowerShell with PSReadLine, Bash, Zsh and Fish use existing shell hooks. cmd/unsupported shells and overwritten prompt hooks cannot provide reliable command activity. SSH automatic injection currently covers detected Bash; other remote shells require compatible OSC 133 integration. The Codex loopback helper is **local-only**; SSH/WSL/container hosts are not automatically bridged.
- Codex hooks are observations, not a complete runtime state API. A denied/blocked hook or request may leave attention/busy until the next observed event. Internal errors without a completion or interrupt event are not inferred from output. A `notify` completion means the turn ended, not that every tool succeeded.
- Nested independently integrated shells share a terminal stream; there is no authenticated stack of shell OSC sessions. The host never interprets status events as permission to execute a command.

Sources: [Codex hooks](https://developers.openai.com/codex/hooks/), [Codex notifications](https://developers.openai.com/codex/config-advanced/#notifications), [Electron notifications](https://www.electronjs.org/docs/latest/tutorial/notifications).
