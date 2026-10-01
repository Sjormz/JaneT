---
title: Terminals and panes
description: Work with local terminals, split layouts, commands, and shortcuts in JaneT.
---

# Terminals and panes

Each project holds a layout of local terminals. Split a terminal into panes to keep related commands visible together; the layout is saved automatically.

![JaneT workspace showing a project with multiple terminal panes](/screenshots/workspace-overview.png)

*Each project can keep a terminal layout and its file tools in one workspace.*

## Open and arrange terminals

- Create a project with **Add terminals** (**New project**, `Ctrl+Shift+T` or `Cmd+T` on macOS, opens the form). To add terminals to the current project, select **Add terminals** (the **+** button) on a pane or press **Add terminals to current project** (`` Ctrl+Shift+` ``). A project without terminals shows **Start terminals** instead.
- Use the pane header controls to split, maximize, restore, rename, or close a pane. The controls appear when you point at a pane or move keyboard focus into it; the active pane has an accent outline. Drag a pane by its header to rearrange it; drag a divider to resize the layout. Closing the last pane keeps the project.
- Select a project in the sidebar, or use **Previous project** and **Next project**, to switch between projects. The **Terminal** surface tab returns from an open editor document to the terminal layout.
- Press **Escape** or choose **Cancel broadcast input** in the banner to stop broadcast input.

After creating a project with terminals, adding terminals, switching projects, or clicking **Terminal** above an open file, you can type in the new or last-used pane without clicking it first. Clicking a pane heading also returns typing focus to that pane. Files, Source Control, Settings, and editor controls keep focus while you use them. You can navigate the sidebar and controls with the keyboard without moving focus to the terminal.

Initial project setup accepts 1–16 terminals. JaneT also enforces an application-wide limit of 64 terminals; if it is reached, close a terminal before adding another. Each local shell starts in its configured directory. Terminals added to a Workspace project start in its folder; terminals of a Library project start in the Library entry's folder, or in the worktree folder for a worktree project.

## Search, copy, paste, and paths

Open **Search terminal output** (`Ctrl+Shift+F`, or `Cmd+F` on macOS) to find text in the current terminal buffer. Copy and paste follow each platform's terminal convention: `Ctrl+Shift+C` and `Ctrl+Shift+V` on Windows and Linux, `Cmd+C` and `Cmd+V` on macOS. On Windows and Linux, `Ctrl+C` also copies while text is selected, and on Windows `Ctrl+V` also pastes. See [Copy and paste in a terminal](/reference/shortcuts#copy-and-paste-in-a-terminal) for every key. Dragging a file or folder from Explorer into a local terminal pastes its shell-escaped path; the path copy button beside an item does the same through the clipboard.

Terminal applications such as Vim, tmux, or agent TUIs may capture the mouse. To make a native text selection in that situation, hold **Shift** while dragging on Windows/Linux or **Option** while dragging on macOS, then use the platform copy shortcut. Some terminal applications also support OSC 52 clipboard copying; JaneT asks before accepting unsolicited clipboard changes.

JaneT supports a bounded subset of Kitty terminal graphics. See [Terminal graphics](/reference/terminal-graphics) for details and limits.

## Navigate completed commands

When a supported shell reports command boundaries, use **Previous semantic command** and **Next semantic command** to move between completed commands. You can copy a command, copy its output, or paste the command for editing. Pasting a command never presses Enter; review it and run it yourself.

JaneT installs semantic markers in new local Bash, Zsh, Fish, Windows PowerShell, and PowerShell 7 terminals where possible, preserving existing prompt hooks. Unsupported shells still work as ordinary terminals, but may not provide semantic command navigation or reliable command completion notifications.

Zsh terminals load your own startup files before JaneT adds its integration: `.zshenv`, then `.zshrc`, plus `.zprofile` and `.zlogin` for login shells. JaneT reads them from your `ZDOTDIR` when it is set in the environment JaneT was started from, otherwise from your home folder. A `ZDOTDIR` exported by `~/.zshenv`, such as `~/.config/zsh`, is used for the files that follow. Inside the shell, `ZDOTDIR` keeps your value, so nested Zsh shells use your configuration.

Completed command history is local and bounded to the latest 256 entries. It stores command text, timing, outcome, and working directory, but not terminal output or imported shell-history files. Open **Open command history** from the command palette to search it; choosing a result pastes the command into the focused terminal without running it.

## Use snippets and the command palette

Open **Search commands** in the title bar or press the command palette shortcut to find app actions. Open **Snippets** to save reusable text and paste a chosen snippet into the focused terminal. JaneT does not run snippets automatically.

Open **Settings**, then **Keyboard shortcuts**, to see or change the bindings. Defaults vary by platform; some actions, including snippets and command history, may be unbound until you assign a shortcut. The command palette remains available for actions without shortcuts. JaneT's default shortcuts leave shell and terminal-program keys such as `Ctrl+W`, `Ctrl+B`, `Ctrl+F`, and `F2` to the terminal, and the shortcut editor warns you if a shortcut you choose would take one of them.

## Send the same input to selected panes

Broadcast input sends what you type or paste to every pane you select. It is off until you explicitly select at least two panes and confirm the recipient set.

1. Split the project's terminals so the intended recipients are visible.
2. Point at each pane and select the broadcast checkbox in its header, including the pane where you plan to type. Selected checkboxes stay visible.
3. Confirm the selection when JaneT asks.
4. Type or paste in any selected pane. JaneT sends the input once to each selected terminal.
5. Press **Escape** or select **Cancel broadcast input** to stop.

Selected panes stay highlighted while broadcasting. JaneT clears the set if a selected pane or terminal closes, you switch projects, or a terminal becomes stale. Terminal protocol responses are not rebroadcast.

## Read agent activity

For supported agents, JaneT can show status such as **Running**, **Needs input**, **Ready**, or a completed result in the pane and workspace sidebar. Activity uses explicit lifecycle hooks and does not read the agent transcript. It is best-effort workspace information, not an authenticated signal about which process produced terminal output.

See [Agent activity](/guide/agent-activity) for Hermes setup, the current Codex limitation, shell coverage, and other limits. Activity setup does not automatically bridge SSH, WSL, or container hosts; those terminals still work as ordinary terminals.
