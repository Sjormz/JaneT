---
title: Keyboard shortcuts
description: JaneT's default keyboard shortcuts for Windows, Linux, and macOS, plus how to customize them.
---

# Keyboard shortcuts

Windows and Linux use the first default column. macOS uses the second. Defaults marked **Unassigned** have no shortcut until you set one.

JaneT's shortcuts stay out of the way of your shell and terminal programs. On Windows and Linux, app shortcuts use `Ctrl+Shift`, like Windows Terminal and GNOME Terminal, so keys such as `Ctrl+W` (delete a word), `Ctrl+B` and `Ctrl+F` (move the cursor), `Ctrl+\` (quit a program), and `F2` still reach the shell, vim, Emacs, nano, tmux, htop, and similar programs. On macOS, app shortcuts use `Cmd`, which terminal programs never receive.

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Open command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| Search terminal output | `Ctrl+Shift+F` | `Cmd+F` |
| New project | `Ctrl+Shift+T` | `Cmd+T` |
| Add terminals to current project | `` Ctrl+Shift+` `` | `` Ctrl+Shift+` `` |
| Close current terminal | `Ctrl+Shift+W` | `Cmd+W` |
| Open settings | `Ctrl+,` | `Cmd+,` |
| Show or hide project tools | `Ctrl+Shift+B` | `Cmd+B` |
| Increase terminal text size | `Ctrl+Plus` | `Cmd+Plus` |
| Decrease terminal text size | `Ctrl+-` | `Cmd+-` |
| Reset terminal text size | `Ctrl+0` | `Cmd+0` |
| Previous project | `Ctrl+Shift+Tab` | `Ctrl+Shift+Tab` |
| Next project | `Ctrl+Tab` | `Ctrl+Tab` |
| Split pane right | `Ctrl+Shift+5` | `Cmd+\` |
| Split pane below | `Ctrl+Shift+'` | `Cmd+Shift+\` |
| Close current pane | Unassigned | `Cmd+Shift+W` |
| Rename current terminal | `Ctrl+Shift+F2` | `Cmd+Shift+F2` |
| Rename current project | `Ctrl+Shift+I` | `Cmd+F2` |
| Previous semantic command | `Ctrl+Shift+ArrowUp` | `Cmd+ArrowUp` |
| Next semantic command | `Ctrl+Shift+ArrowDown` | `Cmd+ArrowDown` |
| Copy semantic command | `Ctrl+Shift+K` | `Cmd+Option+C` |
| Copy semantic command output | `Ctrl+Shift+O` | `Cmd+Option+O` |
| Paste semantic command for rerun | `Ctrl+Shift+R` | `Cmd+Option+R` |
| Open snippets | Unassigned | Unassigned |
| Open command history | Unassigned | Unassigned |
| Maximize or restore current pane | Unassigned | Unassigned |
| Focus next pane | Unassigned | Unassigned |
| Focus previous pane | Unassigned | Unassigned |
| Move current pane left, right, up, or down | Unassigned | Unassigned |
| Save current document | Unassigned | Unassigned |
| Close current document | Unassigned | Unassigned |

Shortcuts follow the key you press, not the character it types, so `Ctrl+Shift+5` works even though Shift turns `5` into `%`. `Ctrl+Plus` works with the `=` key, the numpad `+` key, or a layout's own `+` key. On other keyboard layouts, digit and punctuation shortcuts use the key in the same position as on a US keyboard.

**New project** opens **Create project** for the Workspace or Library entry that holds the current project; see [Create a project from the keyboard](/guide/workspaces#create-a-project-from-the-keyboard). **Add terminals to current project** opens **Add terminals**, like the **+** button on a pane; in a project without terminals it moves to the **Start terminals** form.

`` Ctrl+Shift+` `` is the key to the left of `1` on a US keyboard, the same key Visual Studio Code uses to create a terminal. It sends nothing to terminal programs, so no shell or TUI key is lost. JaneT uses it on macOS too, because `` Cmd+` `` switches windows there.

**Close current terminal** closes the focused pane. Closing a project's last pane keeps the project, ready for **Start terminals**. On Windows and Linux it covers **Close current pane**, which you can still assign if you want a separate shortcut.

The semantic command shortcuts need [shell integration](/guide/terminals#navigate-completed-commands) and apply to the shell's normal screen. While a full-screen program such as vim, htop, or lazygit is running, those keys go to the program.

## Copy and paste in a terminal

| Action | Windows | Linux | macOS |
| --- | --- | --- | --- |
| Copy selected text | `Ctrl+Shift+C`, or `Ctrl+C` while text is selected | `Ctrl+Shift+C`, or `Ctrl+C` while text is selected | `Cmd+C` |
| Paste | `Ctrl+Shift+V`, `Ctrl+V`, or `Shift+Insert` | `Ctrl+Shift+V` or `Shift+Insert` | `Cmd+V` |
| Send interrupt | `Ctrl+C` with no selection | `Ctrl+C` with no selection | `Ctrl+C` |

Right-clicking a terminal copies the selection, or pastes when nothing is selected. On Linux and macOS, `Ctrl+V` goes to the terminal program, so vim's block selection and the shell's insert-next-key-literally both work. On macOS, `Ctrl+C` always interrupts, even when text is selected.

## Customize a shortcut

1. Open **Settings** from the title bar.
2. Select **Keyboard shortcuts**.
3. Select the shortcut shown beside an action, then press the key combination you want. Include a modifier such as Ctrl, Alt, Shift, or Command, or use an F1–F12 key.
4. To unassign an action, select its shortcut and press **Backspace** or **Delete**.

JaneT shows a warning under a shortcut that another action already uses, or that takes a key your shell, terminal programs, keyboard layout, or operating system needs. For example, `Ctrl+W` on Windows or Linux would stop deleting words in the shell, and `Ctrl+Alt` combinations act as AltGr on many European layouts. You can keep the shortcut, but JaneT intercepts it in every terminal.

To restore all defaults, select **Reset shortcuts to defaults** and confirm. This replaces every custom shortcut. Some actions are also available in the command palette if you leave them unassigned.

## Changes to the default shortcuts

Versions of JaneT after 0.14.0 changed several defaults so they no longer block terminal keys. When you update, every shortcut you left at its old default moves to the new default. Shortcuts you changed yourself stay as you set them. If a new default would duplicate one of your custom shortcuts, that action is left unassigned instead.

| Action | Old Windows / Linux | Old macOS |
| --- | --- | --- |
| Search terminal output | `Ctrl+F` | `Cmd+F` (unchanged) |
| Close current terminal | `Ctrl+W` | `Cmd+W` (unchanged) |
| Show or hide project tools | `Ctrl+B` | `Cmd+B` (unchanged) |
| Split pane right | `Ctrl+\` | `Cmd+\` (unchanged) |
| Split pane below | `Ctrl+Shift+\` | `Cmd+Shift+\` (unchanged) |
| Close current pane | `Ctrl+Shift+W` | `Cmd+Shift+W` (unchanged) |
| Rename current terminal | `F2` | `F2` |
| Rename current project (was Rename current tab) | `Ctrl+F2` | `Cmd+F2` (unchanged) |
| Previous and next semantic command | `Ctrl+Shift+ArrowUp` and `Ctrl+Shift+ArrowDown` (unchanged) | `Ctrl+Shift+ArrowUp` and `Ctrl+Shift+ArrowDown` |
| Copy semantic command, output, and rerun | `Ctrl+Alt+C`, `Ctrl+Alt+O`, `Ctrl+Alt+R` | `Ctrl+Option+C`, `Ctrl+Option+O`, `Ctrl+Option+R` |

The next version after 0.14.1 replaced terminal tabs with projects. **New terminal tab** became **New project** on the same key (`Ctrl+Shift+T`, or `Cmd+T` on macOS); if you had changed that key, your choice now opens **New project**. **Previous project**, **Next project**, and **Rename current project** keep their keys. The new **Add terminals to current project** action gets `` Ctrl+Shift+` `` unless one of your own shortcuts already uses it; then it stays unassigned.
