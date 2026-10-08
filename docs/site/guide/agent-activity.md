---
title: Agent activity
description: Understand JaneT's Codex, Claude Code and Hermes activity indicators and their limits.
---

# Agent activity

JaneT can show when a supported terminal agent is running, ready, waiting for input, or finished. The indicators help you find a terminal that needs attention. They report lifecycle events; they do not read the conversation transcript or approve requests on your behalf.

Agent lifecycle status is bounded metadata, not an authenticated security signal. Check the agent terminal before making a consequential decision.

![JaneT workspace sidebar and terminal pane headers showing ready indicators](/screenshots/workspace-overview.png)

*Activity indicators appear beside workspace items and in terminal pane headings.*

## Read the indicators

| Indicator | Meaning |
| --- | --- |
| Green | Shell or agent ready; **new** means a result you have not viewed. |
| Yellow | Foreground command or agent turn running. Project rows may show a busy terminal count. |
| Amber diamond | The agent requested attention, such as an approval. Review the request in the agent itself. |
| Red | Unseen failure. |
| Muted | No integration, or the process ended or disconnected. |

Visiting a project acknowledges its unseen results. Activity is live terminal state, so a restarted terminal must establish its own status again.

## Codex CLI

Choose **Codex** under **Start terminals with**, or type `codex` in a new local terminal. JaneT passes its activity hooks and a completion callback to Codex as session-only settings for that launch. It does not edit `~/.codex/config.toml`, `hooks.json`, profiles, or project trust.

The first time, Codex shows **Hooks need review**. Choose **Review hooks** (or **Trust all and continue**) to allow the hooks labeled *JaneT activity*. Codex remembers that decision, so later launches don't ask again unless JaneT's hooks change. If you choose **Continue without trusting**, Codex still works, but the pane stays at **Awaiting activity**.

Requirements: Node.js on `PATH` and Codex CLI 0.159 or later. The pane shows Ready, Running, **Needs input** for approval requests, and Turn finished or Interrupted.

Behavior limits:

- An existing `notify` command (root or selected profile) keeps working: JaneT runs it with Codex's original payload after recording the turn.
- If you pass your own `-c notify=...`, Codex uses it and the pane shows **Activity tracking incomplete**.
- Help, version and management commands such as `codex login` or `codex mcp` run without JaneT settings. `codex resume`, `fork`, `exec` and `review` are tracked.
- A turn-finished event means the turn ended, not that every tool succeeded.

Older JaneT versions saved Codex hooks and a forwarding `notify` in your Codex configuration. The first Codex launch from this version removes those entries and restores your original `notify`. Backups end in `.janet-backup-*`.

With desktop notifications on, JaneT alerts you when Codex needs input or finishes a turn while the window is unfocused.

## Claude Code

Choose **Claude** under **Start terminals with**, or type `claude` in a new local terminal. JaneT starts Claude Code with an extra session-only settings file that adds its activity hooks for that launch. Your `~/.claude` settings, project settings, permissions, and existing hooks are not changed, and JaneT never answers a permission prompt for you.

Requirements: Node.js on `PATH` and Claude Code 2.1.196 or later. The pane shows **Claude · Awaiting activity** until the session starts, then Ready, Running, **Needs input** for permission prompts, and Turn finished, Interrupted, or Turn failed. With desktop notifications on, JaneT can also alert you when Claude needs input or finishes a turn while the window is unfocused.

Behavior limits:

- If you pass your own `--settings`, JaneT leaves the launch unchanged and shows **Activity tracking incomplete**.
- Help, version, background (`--bg`) and management commands such as `claude mcp` run without JaneT hooks.
- `disableAllHooks` or administrator policy can block the hooks; the pane then stays at **Awaiting activity**.
- Subagent activity is not tracked separately. If another Stop hook makes Claude continue, the pane can briefly show the turn as finished before it returns to Running.

## Hermes CLI and TUI

Type `hermes` or `hermes --tui` in a new local terminal. JaneT adds activity observers to an existing Hermes profile while retaining its other configuration. Unlike Claude Code and Codex, these hooks are saved in Hermes's configuration; see [Turn off or remove agent activity](#turn-off-or-remove-agent-activity). Review any Hermes hook-consent prompt yourself. JaneT does not create a missing profile or change its safety policy.

## When an indicator is incomplete

Claude Code, Codex and Hermes launch setup covers PowerShell, Bash, Zsh, and Fish. It does not automatically follow an explicit binary path, nested shell, `cmd.exe`, SSH, WSL, or container host. Those terminals remain usable as ordinary terminals. An uninstrumented long-running TUI is a shell command; JaneT cannot infer the agent's turn completion from terminal silence.

Hook delivery can also be blocked or delayed by the agent's own policy or runtime. Treat the indicator as a cue to inspect the agent terminal, not as confirmation that a tool succeeded. For implementation details and diagnostics, see the [activity integration notes](https://github.com/Sjormz/JaneT/blob/main/docs/terminal-activity.md).

## Turn off or remove agent activity

Open **Settings** and turn off **Show agent activity** under **Agents**. New terminals then start Claude Code, Codex and Hermes without JaneT's wrappers, and JaneT removes the entries it saved in agent configuration:

- **Hermes:** JaneT's observer hooks in each profile's `config.yaml`. Your other hooks and settings stay.
- **Codex:** hooks and forwarding `notify` entries saved by older JaneT versions, with your original `notify` restored.
- **Claude Code:** nothing to remove; JaneT never saves Claude settings.

Changed files get a `.janet-backup-*` copy next to them. JaneT shows what it removed below the switch. Terminals that are already open keep their current session until you close them. Turn the switch back on to restore activity in new terminals; Hermes hooks are added again on its next launch.

![JaneT Settings with the Agents group and its Show agent activity switch](/screenshots/settings-overview.png)

*Settings → Agents → Show agent activity.*

If you uninstall JaneT, remove these entries first by turning off **Show agent activity**. If JaneT is already uninstalled and its data folder remains, run the helper yourself with Node.js:

```powershell
node "$env:APPDATA\janet\agent-activity\agent-cli.cjs" --uninstall
```

On macOS the helper is in `~/Library/Application Support/janet/agent-activity/`, and on Linux in `~/.config/janet/agent-activity/`.
