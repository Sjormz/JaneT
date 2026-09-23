---
title: Terminals and panes
description: Work with local terminals, split layouts, commands, and shortcuts in JaneT.
---

# Terminals and panes

JaneT opens local shell sessions in terminal tabs. Split a tab into panes to keep related commands visible together; the layout is saved automatically.

![JaneT workspace showing a project with multiple terminal panes](/screenshots/workspace-overview.png)

*Each project can keep a terminal layout and its file tools in one workspace.*

## Open and arrange terminals

- Create a project with **Add terminals**, or use **Add terminals** on an existing pane to add terminals to that session.
- Use the pane header controls to split, maximize, restore, rename, or close a pane. Drag a pane by its header to rearrange it; drag a divider to resize the layout.
- Use the terminal tabs to switch between saved sessions. The **Terminal** surface tab returns from an open editor document to the terminal layout.
- Press **Escape** or choose **Cancel broadcast input** in the banner to stop broadcast input.

After creating a project with terminals, adding terminals, switching terminal tabs, or clicking **Terminal** above an open file, you can type in the new or last-used pane without clicking it first. Clicking a pane heading also returns typing focus to that pane. Files, Source Control, Settings, and editor controls keep focus while you use them. You can navigate tabs and controls with the keyboard without moving focus to the terminal.

Initial project setup accepts 1–16 terminals. JaneT also enforces an application-wide restored terminal limit; if it is reached, close a terminal before adding another. Each local shell starts in its configured directory. Projects in a linked Library folder start in that shared folder.

## Search, copy, paste, and paths

Open **Search terminal output** to find text in the current terminal buffer. Standard terminal copy and paste use your platform's keyboard shortcuts. Dragging a file or folder from Explorer into a local terminal pastes its shell-escaped path; the path copy button beside an item does the same through the clipboard.

Terminal applications such as Vim, tmux, or agent TUIs may capture the mouse. To make a native text selection in that situation, hold **Shift** while dragging on Windows/Linux or **Option** while dragging on macOS, then use the platform copy shortcut. Some terminal applications also support OSC 52 clipboard copying; JaneT asks before accepting unsolicited clipboard changes.

JaneT supports a bounded subset of Kitty terminal graphics. See [Terminal graphics](/reference/terminal-graphics) for details and limits.

## Navigate completed commands

When a supported shell reports command boundaries, use **Previous semantic command** and **Next semantic command** to move between completed commands. You can copy a command, copy its output, or paste the command for editing. Pasting a command never presses Enter; review it and run it yourself.

JaneT installs semantic markers for new local Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7 sessions where possible, preserving existing prompt hooks. Unsupported shells still work as ordinary terminals, but may not provide semantic command navigation or reliable command completion notifications.

Completed command history is local and bounded to the latest 256 entries. It stores command text, timing, outcome, and working directory, but not terminal output or imported shell-history files. Open **Open command history** from the command palette to search it; choosing a result pastes the command into the focused terminal without running it.

## Use snippets and the command palette

Open **Search commands** in the title bar or press the command palette shortcut to find app actions. Open **Snippets** to save reusable text and paste a chosen snippet into the focused terminal. JaneT does not run snippets automatically.

Open **Settings**, then **Keyboard shortcuts**, to see or change the bindings. Defaults vary by platform; some actions, including snippets and command history, may be unbound until you assign a shortcut. The command palette remains available for actions without shortcuts.

## Send the same input to selected panes

Broadcast input sends what you type or paste to every pane you select. It is off until you explicitly select at least two panes and confirm the recipient set.

1. Split the terminal tab so the intended recipients are visible.
2. Select the broadcast checkbox in each pane header, including the pane where you plan to type.
3. Confirm the selection when JaneT asks.
4. Type or paste in any selected pane. JaneT sends the input once to each selected terminal.
5. Press **Escape** or select **Cancel broadcast input** to stop.

Selected panes stay highlighted while broadcasting. JaneT clears the set if a selected pane, tab, or terminal closes or becomes stale. Terminal protocol responses are not rebroadcast.

## Read agent activity

For supported agent sessions, JaneT can show status such as **Running**, **Needs input**, **Ready**, or a completed result in the pane and workspace sidebar. Activity uses explicit lifecycle hooks and does not read the agent transcript. It is best-effort workspace information, not an authenticated signal about which process produced terminal output.

See [Agent activity](/guide/agent-activity) for supported Codex and Hermes setup, shell coverage, and limitations. In particular, activity setup does not automatically bridge SSH, WSL, or container hosts; those sessions may still be used as ordinary terminal sessions.
