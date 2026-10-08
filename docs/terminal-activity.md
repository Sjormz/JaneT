# Terminal and project activity

JaneT uses explicit shell/agent lifecycle events, never silence or screen scraping.

- Green: shell/agent ready. Green with `new`: an unseen result.
- Yellow: a foreground command or agent turn is running. Project rows include the busy terminal count.
- Amber diamond: the agent requests attention. This can precede a native approval dialog; it does not mean JaneT grants approval.
- Red: unseen failure. Muted: no integration, exited or disconnected. Hover/accessible labels explain each state.
- Unseen results remain while other terminals run. Visiting a project acknowledges its results; returning focus acknowledges the currently visible project. Indicators are live session state, not persisted claims about restarted processes.

## Codex CLI (session-only)

Requires Node.js on PATH and Codex CLI 0.159+ (session `-c hooks.*` overrides and `notify`). Verified with the installed Codex CLI 0.159.3 and a disposable local Responses provider (`scripts/test-codex-activity.mjs`).

1. Type `codex` normally (or pick the **Codex** launcher). The shell wrapper runs `agent-cli.cjs --setup-codex <args>`, which prints one `-c` value per line. The wrapper passes them before the user's arguments, so a user `-c` still wins.
2. The values add JaneT's hooks (`hooks.<Event>=[...]`, labeled `JaneT activity`) and a `notify` forwarder for this session only. JaneT writes nothing to `CODEX_HOME`. Codex stores the user's trust decision itself under `<session-flags>`, so the "Hooks need review" prompt appears once per hook content, not per launch. Hooks the user already has (`hooks.json`, inline `[hooks]`) still run; the real-CLI regression asserts this.
3. Values contain no double quotes (TOML literal strings; the forwarded argv is base64url). Windows PowerShell 5.1 strips embedded double quotes from native command arguments, which would silently corrupt TOML.
4. Help/version and management subcommands (`login`, `mcp`, `features`, ...) run unchanged; `resume`, `fork`, `exec`, `e` and `review` are tracked. Resume/fork arguments, normal TTY interaction, piped PowerShell input and exit status are retained.

Mapping: SessionStart → ready; UserPromptSubmit → busy; PermissionRequest → attention; Pre/PostToolUse → running; Interrupt → interrupted; SessionEnd → session removed. The `notify` event `agent-turn-complete` supplies the finished signal. `Stop` is deliberately not used: another Stop hook can continue the turn. Subagent hooks are dropped. Duplicate terminal completion is suppressed when an agent integration already owns that command.

The helper sends only bounded event/session/turn identifiers and setup availability over a loopback-only per-terminal capability URL. Prompt text, tool input/output, transcript paths and assistant messages never go to JaneT. Closing the terminal revokes the URL. No approval decisions are returned by the helper.

### Existing notify handler

`--setup-codex` resolves the notifier Codex would run (selected `-p` profile file, `[profiles.<name>]`, or root; legacy JaneT forwarders stripped) and passes `node <helper> --codex-notify-forward-b64 <argv>`. The forwarder runs that command without a shell, with every argument and Codex's original JSON payload. A failing notifier cannot suppress JaneT's completion event. A user-supplied `-c notify=...` takes precedence; JaneT reports **Activity tracking incomplete** for that launch. Setup failures use the same fallback. Do not put `notify` in project config: Codex ignores it there.

### Migration from persistent installs

Builds before 0.13.1 appended hooks to `~/.codex/hooks.json` and wrapped `notify` (root, inline profiles, `<name>.config.toml`). `--setup-codex` removes those entries once, before launch: only hooks whose command is JaneT's `agent-cli.cjs --codex-hook` with status `JaneT activity`, and only JaneT forwarders. A computer-use callback whose previous notifier was only JaneT returns to `[codex-computer-use.exe, "turn-ended"]`. Ordinary launches only read. Writes take the `.janet-activity.lock`, back up each changed file as `*.janet-backup-*`, recheck for external edits before each rename, and roll back without overwriting later user edits. Codex-owned `[hooks.state]` trust records are left alone.

## Turning off and uninstalling

**Settings → Agents → Show agent activity** (setting `agentIntegrations`, default on). When off, new terminals get no activity URL, so the shell init adds no agent wrappers; open terminals keep their session. Turning it off also runs `agent-cli.cjs --uninstall` through Electron as Node (`ELECTRON_RUN_AS_NODE`, so Node need not be on PATH). That removes the Codex entries above and JaneT's Hermes hooks from the default and `HERMES_HOME` roots and every profile's `config.yaml`, with backups. Claude Code needs nothing: its settings file lives in JaneT's app data and is only passed with `--settings`. The command prints a per-agent summary and exits non-zero if any agent could not be cleaned safely. After JaneT is uninstalled, the same command can be run with `node` from the remaining app-data folder.
## Claude Code

Type `claude` normally (or pick the **Claude** launcher). The shell wrapper runs `agent-cli.cjs --setup-claude <args>`; on exit 0 it launches `claude --settings <app-data>/agent-activity/claude-settings.json <args>`, otherwise it launches the original command unchanged. The main process writes that settings file at startup. It contains only exec-form `node <helper> --claude-hook` hooks (no shell quoting), so Claude merges them additively for this session. JaneT never edits `~/.claude`, project settings or trust.

Setup skips help/version, `--bg`/`--background` and the known management subcommands. An explicit user `--settings` is never overridden; JaneT reports **Activity tracking incomplete** for that launch.

Mapping: SessionStart → ready; UserPromptSubmit → busy; Pre/PostToolUse, PostToolUseFailure, PermissionDenied → running; PermissionRequest and `Notification` (`permission_prompt`, `elicitation_dialog`, `elicitation_url_dialog`) → attention; Stop → finished (`stop_reason: user_stop` → interrupted); StopFailure → failed; SessionEnd → session removed. `prompt_id` (Claude Code 2.1.196+) is the turn id; turn events without it are ignored. Hooks carrying `agent_id` (subagents and background agents) are dropped. Because another Stop hook can continue a turn, the bridge reopens a Claude turn when a tool event arrives after its Stop. The completion notification may already have fired for that turn.

The payload is reduced to session/prompt identifiers before leaving the helper. Prompts, tool input/output, transcript paths and assistant messages never reach JaneT.

## Hermes CLI and TUI

Type `hermes` or `hermes --tui` normally. JaneT adds observer hooks to the selected profile's existing `config.yaml`, preserving unrelated values/comments and making a backup. It respects `HERMES_HOME`, explicit `--profile`/`-p`, sticky profiles and the native Windows data root. It does not create missing Hermes profiles/configuration or alter safe-mode, plugin enablement or hook-consent policy. Accept only the hook prompts you have reviewed; no `--accept-hooks` flag is injected.

`pre_llm_call` starts a top-level turn; canonical `on_session_end` supplies success/failure/interruption. This event is turn finalization, not merely closing Hermes. Approval hooks report attention only with real session/turn IDs; automated smart approval and ambiguous legacy events are ignored. Child turn completion cannot finish the parent's status. Existing Hermes graphics handling is retained.

## Launch and platform limits

Automatic launch wrappers cover PowerShell, Bash, Zsh and Fish. Existing aliases/functions are not overwritten. Explicit binary paths, `command codex`, nested shells, `cmd.exe`, SSH, WSL and containers do not automatically receive the launch setup. Node must be on PATH. Setup failure does not prevent the agent from launching. A stale setup lock is left intact and reported rather than guessed safe to delete.

The app bundles the helper, copies it to a stable app-data path, and uses the existing per-terminal loopback capability. It never sends prompts, transcript paths, tool inputs, assistant messages or approval decisions to JaneT; only the pre-existing notifier receives its original payload. Session/turn matching rejects unrelated completions; same-session Codex compaction preserves the current turn.

## Other agent CLIs researched

| CLI | Verified extension route | Current JaneT support |
| --- | --- | --- |
| Claude Code | Additive session-only `--settings`; lifecycle hooks | Supported (see above). `Stop` can request continuation; the bridge reopens such turns. |
| OpenCode | Additive plugin configuration; native session status/idle/error and permissions | Researched, not installed. Requires explicit parent/child and multi-session routing tests. |
| Gemini CLI | BeforeAgent/AfterAgent/notification hooks | Researched, not installed. No verified additive ephemeral loader; system-setting replacements would override policy. AfterAgent can retry. |
| Copilot CLI | Dedicated user hooks file | Researched, not installed. Persistent setup/consent and final-versus-continuation semantics need a separate adapter. |

Primary research: [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Claude hooks](https://code.claude.com/docs/en/hooks), [OpenCode plugins](https://opencode.ai/docs/plugins/), [OpenCode configuration](https://opencode.ai/docs/config/), [Gemini hooks](https://geminicli.com/docs/hooks/reference/), [Copilot hooks](https://docs.github.com/en/copilot/reference/hooks-reference), [Hermes hooks](https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/).

## Command notifications

Settings still control the threshold and unfocused-only desktop notification policy. Timing uses a monotonic clock; signed Windows exit codes are accepted. Missing command text no longer prevents completion tracking. A TUI's alternate-screen markers do not cancel the outer shell command. Notification contents exclude command/output text.

Clicking a current-session toast opens its project and terminal. Stale targets are ignored; after an application restart an old toast opens JaneT but cannot resurrect an ended terminal. Windows toasts use `janet://notification/` protocol activation (`janet-dev://` in development), with only an opaque session key accepted. Development registration includes the app entry path and uses a separate notification identity while preserving the existing settings location. The native activation callback remains for older toasts. **Check notification delivery** in Settings reports native failures; `show()` returning is not proof the OS displayed a toast. OS permissions and Do Not Disturb remain authoritative.

## Honest boundaries

### Real Codex regression (opt-in)

`node scripts/test-codex-activity.mjs` runs the installed Codex TUI, not synthetic hook payloads. It creates a disposable test profile, serves deterministic Responses SSE on localhost, types two prompts, and asserts real callbacks drive JaneT's bridge and renderer reducer through Ready → Running → Ready twice. No OpenAI credentials or paid model requests are used. Set `JANET_CODEX_TEST_BINARY` to test another installed CLI binary.

Build JaneT first. The runner creates an empty work directory and `CODEX_HOME` under `%TEMP%/janet-real-codex-*`, configures a local test model, and explicitly trusts only its own disposable work directory. It uses Codex's `--dangerously-bypass-hook-trust` only for the hooks it just generated in this isolated profile; JaneT's normal launches do not pass that flag or trust project directories. The runner passes exactly the `-c` values `--setup-codex` prints, asserts that setup leaves `config.toml` byte-identical, and checks that a pre-existing user `notify` command and user `UserPromptSubmit` hook still run on every turn. It uses read-only sandbox mode. Never point it at your real Codex home.

Set `JANET_CODEX_TEST_DISABLE_NOTIFY=1` for the negative control: the test **must fail** waiting for completion while state remains Running. Clear that variable for normal runs. On Windows with Codex 0.159.3 (session-only setup), both the positive two-turn run and this expected-failure control were verified. This covers the real CLI, helper, transport and reducer; the separate Electron test covers rendering.

For delivery diagnosis, start JaneT with `JANET_ACTIVITY_DIAGNOSTICS` pointing to a disposable log file. This is off by default. The helper and bridge record timestamps, stage, hashed IDs and HTTP status only; no payloads, prompts, responses, capability URLs or raw IDs. Logging stops at approximately 64 KiB and failures never block terminal operation. Unset the variable on a subsequent launch to disable it.

- Background/detached jobs are not individual foreground commands. Use a foreground `wait`/job-wait command if you need a shell completion notification, or an explicit agent lifecycle adapter. No background-process polling is installed.
- A long-lived uninstrumented TUI is a running shell command, not an AI task. Hermes hooks must be accepted and enabled; its open process alone cannot identify response completion.
- Local PowerShell with PSReadLine, Bash, Zsh and Fish use existing shell hooks. cmd/unsupported shells and overwritten prompt hooks cannot provide reliable command activity. The Codex loopback helper is **local-only**; SSH/WSL/container hosts are not automatically bridged.
- Codex hooks are observations, not a complete runtime state API. A denied/blocked hook or request may leave attention/busy until the next observed event. Internal errors without a completion or interrupt event are not inferred from output. A `notify` completion means the turn ended, not that every tool succeeded.
- Nested independently integrated shells share a terminal stream; there is no authenticated stack of shell OSC sessions. The host never interprets status events as permission to execute a command.

Sources: [Codex hooks](https://developers.openai.com/codex/hooks/), [Codex notifications](https://developers.openai.com/codex/config-advanced/#notifications), [Electron notifications](https://www.electronjs.org/docs/latest/tutorial/notifications).
