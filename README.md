<p align="center">
  <img src="assets/brand/app-icon.svg" width="96" height="96" alt="JaneT Prompt-J mark">
</p>

<h1 align="center">JaneT</h1>

<p align="center">
  <strong>A focused desktop workspace for terminals, SSH, files, and Git.</strong><br>
  Keep the tools around your shell close without turning your terminal into a full IDE.
</p>

<p align="center">
  <a href="https://github.com/Sjormz/JaneT/releases/latest"><img src="https://img.shields.io/github/v/release/Sjormz/JaneT?display_name=tag&sort=semver" alt="Latest release"></a>
  <a href="https://github.com/Sjormz/JaneT/actions/workflows/ci.yml"><img src="https://github.com/Sjormz/JaneT/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-7aa2f7" alt="Windows, macOS, and Linux">
</p>

<p align="center">
  <a href="https://github.com/Sjormz/JaneT/releases/latest"><strong>Download JaneT</strong></a>
  ·
  <a href="https://github.com/Sjormz/JaneT/issues/new/choose">Report a bug or request a feature</a>
</p>

![JaneT workspace with two terminal panes, saved presets, and the file explorer](assets/screenshots/workspace-overview.png)

JaneT is for work that starts in a shell and quickly spreads across more shells, a remote server, a file tree, and Git. It keeps that working set in one window while your terminals remain real PTY-backed sessions.

## What JaneT brings together

- **Local and SSH terminals:** Run local shells or connect to remote machines with password or private-key authentication.
- **Tabs and split panes:** Build resizable layouts, maximize a pane when it needs your full attention, and mix local and SSH terminals in the same workspace.
- **Grouped workspaces:** Organize live workspaces under collapsible parent groups. Create a workspace with an initial terminal count and configure each pane as local or SSH.
- **Files and editing:** Browse the focused terminal's local directory or a remote machine over SFTP, then open supported text files in the built-in Monaco editor.
- **Everyday Git tools:** Stage, unstage, commit, fetch, pull, push, switch branches, manage worktrees, and safely discard tracked unstaged changes.
- **Automatic restoration:** Groups, workspace membership, pane layouts, directories and startup commands persist automatically—no save button or presets. Closing JaneT ends its managed local and SSH terminal sessions. Restarting restores the saved workspace structure into fresh shells; configured startup commands run again. Detached jobs may continue outside JaneT.
- **Semantic command tools:** Jump between completed commands, copy a command or its output, and paste a command back without running it automatically.
- **Safe broadcast input:** Explicitly select panes, confirm the recipient set, then send the same keyboard, paste, or binary input to every selected terminal.
- **Contextual command history:** Search bounded local history by command text or SSH host without storing terminal output.
- **Focus-away notifications:** Optionally receive a native notification when a long command finishes while JaneT is unfocused.
- **Secure SSH routing:** Reach a saved host through one saved jump host and manage session-owned local forwards from the SSH tab.
- **AI agent awareness:** See when a supported terminal agent is running, ready, waiting for input, or finished without reading its transcript.
- **Fast navigation:** Search terminal output, launch actions from the command palette, save command snippets, and rebind every shortcut.
- **A workspace that feels like yours:** Choose from Tokyo Night, Dracula, One Dark, Solarized Light, and Gruvbox, then tune terminal typography and sidebar placement.

## Navigate completed commands

![JaneT terminal showing completed commands and a failed-command marker](assets/screenshots/semantic-commands.png)

JaneT understands the command lifecycle reported by supported shells. After a command finishes, you can move between completed commands without searching the whole terminal buffer:

| Action | Default shortcut |
| --- | --- |
| Select the previous completed command | `Ctrl+Shift+ArrowUp` |
| Select the next completed command | `Ctrl+Shift+ArrowDown` |
| Copy the selected command | `Ctrl+Alt+C` |
| Copy the selected command's output | `Ctrl+Alt+O` |
| Paste the selected command for editing | `Ctrl+Alt+R` |

Paste for rerun is deliberately safe: it inserts the command through JaneT's normal paste path but never adds Enter. Review or edit it, then press Enter yourself when it is ready.

JaneT automatically adds semantic markers to new local Bash, zsh, fish, Windows PowerShell, and PowerShell 7 sessions while preserving existing prompt hooks. New remote Bash sessions receive the same session-only integration without modifying remote startup files. Unsupported shells continue to work as ordinary terminals.

## Copy from full-screen terminal applications

In `hermes --tui`, drag normally and press Ctrl+Shift+C. JaneT retains the dragged text independently of the TUI's painted highlight, so a subsequent screen redraw does not erase what you copy. A new left click or typing discards the retained selection. Paste continues to use the normal terminal paste path.

Terminal applications such as agent TUIs, Vim, and tmux can take ownership of mouse input. For forced native terminal selection, hold Shift and drag on Windows/Linux, or Option-drag on macOS, then use the normal platform copy shortcut. JaneT automatically protects that selection from TUI mouse reporting and redraws, then restores the application immediately after copying or continuing to type.

Hermes `--tui` can also send its own selection through OSC 52. A copy shortcut or right-click authorizes the immediate copy; unsolicited clipboard replacements ask for confirmation. Terminal applications cannot read your clipboard through OSC 52. Paste with Ctrl+V, Cmd+V, or Shift+Insert; multiline text preserves the terminal's bracketed-paste handling. Right-click copies a native selection, otherwise pastes in ordinary terminals or keeps a mouse-tracking TUI's own gesture.

Click word-labelled terminal links (OSC 8) to open them in your default browser, including while a TUI redraws. Dragging to select text does not activate the link.

## Find a command in contextual history

Completed semantic commands are also available from **Search commands** → **Open command history**.

1. Search by command text or SSH label.
2. Select an entry to paste it into the currently focused terminal.
3. Press Enter yourself if you want to run it.

History is intentionally local and bounded to the newest 256 entries. JaneT stores command text, timing, outcome, and directory or host context; it never stores terminal output or imports your shell-history files.

## Broadcast input only to panes you choose

![JaneT broadcast input active for two selected terminal panes](assets/screenshots/broadcast-input.png)

Broadcast input is useful for running the same interactive step in several local or SSH panes, but it stays off until you deliberately arm it:

1. Split the current tab until every destination pane is visible.
2. Use the checkbox in each pane header to select every recipient, including the pane you will type in.
3. Select at least two panes and confirm the warning.
4. Type or paste in any selected pane. JaneT sends that user input exactly once to every selected recipient.
5. Press `Escape` or choose **Cancel broadcast input** in the banner to stop immediately.

Selected panes remain visibly highlighted while broadcast is active. JaneT cancels the recipient set when its tab, pane, terminal, or SSH session becomes stale, and terminal protocol responses are never rebroadcast.

## Get notified after a long command

![JaneT settings for focus-away command notifications](assets/screenshots/notification-settings.png)

Focus-away notifications are disabled by default. To enable them:

1. Open the gear menu in the title bar.
2. Enable **Notify when long commands finish while JaneT is unfocused**.
3. Set the minimum command duration in seconds. The default is 10 seconds.
4. Move to another window while a tracked command runs.

JaneT checks the current focus state again immediately before showing a native notification. The notification contains only bounded outcome, duration, tab, pane, and local-or-SSH context metadata—never the command text or terminal output. Notification availability and presentation still depend on the operating system's notification support and settings.

## Know when your agent needs you

JaneT can show live agent status in pane headers and tabs, including **Running**, **Needs input**, **Ready**, and completed turn outcomes. Status comes from explicit lifecycle events rather than transcript scraping, so no agent protocol text is added to the visible terminal.

Agent lifecycle status is bounded metadata, not an authenticated security signal. Treat it as workspace guidance, not proof of which process produced the terminal output.

Hermes Agent's classic terminal interface is supported through the included JaneT awareness plugin:

```bash
hermes plugins install Sjormz/JaneT/integrations/hermes-agent-awareness --enable
```

Restart any running Hermes sessions after installation. No JaneT configuration is required.

Other terminal agents continue to work normally in JaneT, but do not show agent-aware status until they provide a compatible lifecycle integration. Hermes TUI awareness is ready in the plugin and will be advertised once its required Hermes runtime fix is available in a public release.

## Build the workspace once

On first launch, choose JaneT's **main directory**. Create a workspace to make a folder beneath it, then use that workspace's + button to create projects as subfolders. Each project has its own terminals. Local terminals start in their project folder unless you supply an override; SSH terminals retain their remote configuration. Click the **Workspaces** heading to change where future workspaces are created. Changing the main directory does not move existing files.

The **Library** section is for persistent work: link a repo or existing directory, then use its **+** to start named sessions with 1–16 terminals. Sessions share that directory; they are not copies or isolated worktrees. Existing folder links automatically appear in Library without moving files.

Workspaces are temporary storage. Right-click a managed project or workspace and choose **Delete…** to send its actual folder and all contents to the OS Recycle Bin/Trash after confirmation. **Close session** only stops terminals and keeps files. **Remove from Library…** only unlinks persistent work and stops its sessions; it never deletes files. Missing directories show **Locate folder**.

To make temporary work permanent, choose **Keep in Library…** on a project and select a destination parent outside temporary storage. JaneT creates a new folder there, copies hidden files and project data, verifies file hashes, saves the Library entry, and recycles the original. The confirmation explains which terminals will stop/reopen. Existing destinations are never merged or overwritten. Save changed editor files and stop external writers first. Failures preserve the original or the verified Library copy; incomplete destination copies are left for inspection. External symlinks cannot be promoted automatically.

Use **+** beside Workspaces to create a workspace folder, then its **+** to create a project with 1–16 initial terminals. Each terminal can use a local directory or saved SSH connection and optional ordered startup commands. The terminal icon on a workspace or project starts a local terminal in that directory. Split and rearrange panes afterward; changes are restored automatically. Renaming managed workspace or project folders also renames them on disk and updates saved paths. Invalid names and existing destination folders are rejected. Close editor files first; programs holding a folder open may also need to be closed. Library entry/session names remain labels and do not rename external folders.

Existing flat sessions appear under **My workspaces**. Legacy preset data is retained in settings for recovery but is no longer shown or launched automatically.

Choosing the main directory does not create starter folders or terminals. Create your workspace and then its projects explicitly, or link a project under Library. Closing the last session leaves an empty screen, preserved after restart; only explicit confirmed Delete actions remove temporary folders.

Sessions work well for an app shell beside a test runner, several services in one grid, or a local project paired with its deployment host.

## Move between terminal and file without losing context

![JaneT built-in editor with terminal and file tabs beside the workspace explorer](assets/screenshots/built-in-editor.png)

The Explorer follows the focused local shell as its working directory changes. In an SSH pane, the same view browses the remote filesystem through SFTP. Open a text file in JaneT's built-in Monaco editor, save it locally or remotely, then return to the terminal tab without leaving the workspace.

Files and folders can also be dragged from the Explorer into a compatible terminal to paste a correctly escaped path.

## Handle everyday Git work in place

![JaneT Source Control panel showing staged and unstaged changes beside split terminals](assets/screenshots/source-control.png)

JaneT detects the repository under the focused local terminal and keeps its status visible. The Source Control panel can:

- stage and unstage individual files or all changes
- commit staged changes
- fetch, fast-forward pull, and push
- create, switch, and safely delete branches
- create, open, remove, and prune Git worktrees
- discard tracked unstaged changes after explicit confirmation
- surface conflicts, ahead/behind counts, and staged or unstaged state

Destructive history operations are deliberately left to the terminal. JaneT does not hide resets, rebases, or force pushes behind a button.

## SSH as part of the workspace

Save an SSH connection once and select it when creating a workspace or from the SSH quick action. JaneT pins host keys, reconnects restored SSH panes, and gives the focused remote terminal an SFTP-backed Explorer and editor.

A workspace can combine local and SSH panes, so a project shell, log stream, and remote deployment session can share one automatically restored layout.

### Reach a host through a jump host

![JaneT SSH connection editor selecting a saved jump host](assets/screenshots/ssh-jump-host.png)

JaneT supports one optional saved jump host per SSH profile:

1. Open **SSH** in the tab rail and save the bastion or jump host as a normal connection first.
2. Create or edit the destination connection.
3. Choose the saved bastion under **Jump host**.
4. Select **Save and connect** or **Update and connect**.

The jump and destination authenticate separately and each host key is verified independently. JaneT supports one hop only; nested or cyclic jump routes are rejected.

### Open a local tunnel through a live SSH session

![JaneT SSH local-forward dialog showing an active loopback tunnel](assets/screenshots/ssh-local-forward.png)

1. Connect an SSH tab and wait until its shell is ready.
2. Right-click that tab and choose **Manage local forwards**.
3. Enter a local port, destination host, and destination port. Use local port `0` to let the operating system choose a free port.
4. Choose **Create forward** and use the displayed `127.0.0.1` port from a local application.
5. Choose **Stop** when the tunnel is no longer needed.

Local forwards bind only to loopback, belong to the live SSH session, and close automatically when that session disconnects. JaneT does not provide public bind addresses, remote forwarding, or a SOCKS proxy.

## Download

Installers and portable builds are published on the [latest release](https://github.com/Sjormz/JaneT/releases/latest):

| Platform | Packages |
| --- | --- |
| Windows x64 | Installer and portable `.exe` |
| macOS Apple silicon | `.dmg` and `.zip` |
| Linux x64 | AppImage and Debian package |

JaneT checks GitHub Releases for updates from inside the app. If an in-app update cannot complete, download and install the latest package from the release page.

### First launch

- **Windows:** Windows builds are unsigned, so Microsoft Defender SmartScreen may warn before launch. Confirm that the download came from the JaneT GitHub release, then use SmartScreen's **More info** → **Run anyway** path if you choose to continue.
- **macOS:** Current builds are ad-hoc signed and not notarized. After attempting to open JaneT, go to **System Settings** → **Privacy & Security** and choose **Open Anyway** for JaneT. See the [release documentation](docs/release.md#macos-release-signing) for the signing policy.
- **Linux AppImage:** Make the downloaded file executable, then run it:

  ```bash
  chmod +x JaneT-<version>-linux-x64.AppImage
  ./JaneT-<version>-linux-x64.AppImage
  ```

## Default shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| New terminal tab | `Ctrl+Shift+T` | `Cmd+T` |
| Search terminal output | `Ctrl+F` | `Cmd+F` |
| Toggle workspace tools | `Ctrl+B` | `Cmd+B` |
| Open snippets | `Unbound` | `Unbound` |
| Split pane right | `Ctrl+\` | `Cmd+\` |
| Split pane below | `Ctrl+Shift+\` | `Cmd+Shift+\` |
| Previous completed command | `Ctrl+Shift+ArrowUp` | `Ctrl+Shift+ArrowUp` |
| Next completed command | `Ctrl+Shift+ArrowDown` | `Ctrl+Shift+ArrowDown` |
| Copy completed command | `Ctrl+Alt+C` | `Ctrl+Alt+C` |
| Copy completed command output | `Ctrl+Alt+O` | `Ctrl+Alt+O` |
| Paste completed command for rerun | `Ctrl+Alt+R` | `Ctrl+Alt+R` |

All shortcuts can be changed in Settings.

## Build from source

JaneT requires Node.js 22.12 or newer.

```bash
git clone https://github.com/Sjormz/JaneT.git
cd JaneT
npm install
npm run dev
```

To investigate terminal selection or mouse-mode behavior without recording terminal contents, enable redacted terminal diagnostics before starting development mode.

PowerShell:

```powershell
$env:JANET_TERMINAL_DIAGNOSTICS='1'
npm.cmd run dev
```

Bash, zsh, or fish:

```bash
JANET_TERMINAL_DIAGNOSTICS=1 npm run dev
```

The renderer console records mouse modifiers, selection lengths, buffer and mouse-tracking modes, resizes, clipboard outcomes, and the names of relevant control sequences. It does not record terminal text, selected text, pasted text, or URLs.

Create and start a production build with:

```bash
npm run build
npm start
```

Create a platform package with `npm run dist`. Platform-specific scripts are also available in `package.json`.

## Tested as a desktop application

Pull requests run TypeScript checks, unit and component tests, a production build, and Electron end-to-end workflows. Release jobs package Windows, macOS, and Linux builds and exercise the packaged terminal runtime before publishing the release assets.

JaneT uses Electron, React, TypeScript, xterm.js, node-pty, Monaco, ssh2, SFTP, and simple-git.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, validation commands, and pull request expectations. Please use the repository's issue templates for bug reports and feature requests, and GitHub's private security advisory flow for security-sensitive reports.

## License

MIT
