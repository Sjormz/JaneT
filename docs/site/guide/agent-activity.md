---
title: Agent activity
description: Understand JaneT's Codex and Hermes activity indicators and their limits.
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

Visiting a project acknowledges its unseen results. Activity is live session state, so a restarted terminal must establish its own status again.

## Codex CLI

Start a **new local terminal** in JaneT and type `codex` normally. JaneT currently leaves Codex's global hooks and notification command untouched. Codex works as a terminal program, but JaneT cannot reliably identify its turn completion or approval requests; the pane may show **Activity tracking incomplete**. JaneT still tracks the foreground shell command.

The **Notify when long commands finish** setting covers tracked shell commands. Codex turn and approval alerts are unavailable while its activity hooks are disabled.

## Hermes CLI and TUI

Type `hermes` or `hermes --tui` in a new local terminal. JaneT adds activity observers to an existing Hermes profile while retaining its other configuration. Review any Hermes hook-consent prompt yourself. JaneT does not create a missing profile or change its safety policy.

## When an indicator is incomplete

Hermes launch setup covers PowerShell, Bash, Zsh, and Fish. It does not automatically follow an explicit binary path, nested shell, `cmd.exe`, SSH, WSL, or container host. Those sessions remain usable as ordinary terminals. An uninstrumented long-running TUI is a shell command; JaneT cannot infer the agent's turn completion from terminal silence.

Hook delivery can also be blocked or delayed by the agent's own policy or runtime. Treat the indicator as a cue to inspect the agent terminal, not as confirmation that a tool succeeded. For implementation details and diagnostics, see the [activity integration notes](https://github.com/Sjormz/JaneT/blob/main/docs/terminal-activity.md).
