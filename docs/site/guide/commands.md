---
title: Commands and snippets
description: Find actions, revisit completed commands, save snippets, and send input to several panes.
---

# Commands and snippets

JaneT keeps frequent terminal actions close to your current shell. Commands copied from history and saved snippets are pasted for review; JaneT does not press Enter for you.

## Find an action

Open **Search commands** in the title bar or press `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS). Type an action name, then choose the result. The palette includes navigation, pane, theme, file, and update actions. [Shortcuts](../reference/shortcuts.md) lists the defaults, and you can change them in Settings.

![JaneT command palette listing terminal, workspace, and app actions](/screenshots/command-palette.png)

*Search commands shows app actions and their assigned shortcuts.*

## Navigate completed commands

Supported shells mark command boundaries as you work. Use **Previous semantic command** or **Next semantic command** to select a completed command. You can then copy its text, copy its output, or paste the command into the active terminal for editing. The paste action never runs it automatically.

![A terminal with a completed command and its outcome marker](/screenshots/semantic-commands.png)

*Semantic markers help you move between commands in a terminal buffer.*

These actions depend on shell integration. New local PowerShell, Bash, Zsh, and Fish sessions receive it where supported; other shells still work as terminals.

## Search command history

Choose **Open command history** from the palette, or use **Search commands** to find it. Search by command text and select an entry to paste it into the focused terminal. Use the remove button beside an entry to delete it.

![Command history dialog with a search field and matching commands](/screenshots/command-history.png)

*Selecting a history result inserts the command without running it.*

JaneT keeps up to 256 recent entries on this computer. History contains command text, timing, outcome, and working directory; it does not save the terminal output. It is separate from your shell's own history file.

## Save reusable snippets

Open **Snippets** from the palette. Create a snippet with a name and content, or edit and delete existing snippets. Search by name, then choose one to paste its text into the focused terminal. Review the text before running it, especially if it changes files or sends data.

![Snippets dialog with a saved demo command and a New snippet button](/screenshots/snippets.png)

*Snippet text is inserted into the terminal for review.*

## Broadcast input to selected panes

Broadcast input sends the same typing and paste to multiple terminals. Select the recipient checkbox in at least two pane headers, including the pane where you will type. JaneT asks you to confirm the recipient count before enabling it.

![Two terminal panes selected for broadcast input with an active status banner](/screenshots/broadcast-input.png)

*The banner shows when broadcast input is active and how many panes receive it.*

While it is active, all typing and paste go to every selected pane. Press `Escape` or choose **Cancel broadcast input** in the banner to stop. Check the recipients before entering a command with side effects.
