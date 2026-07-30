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
- **Reusable presets:** Save a live pane layout, working directories, SSH profiles, and ordered startup commands. Open the whole setup again in one step.
- **Files and editing:** Browse the focused terminal's local directory or a remote machine over SFTP, then open supported text files in the built-in Monaco editor.
- **Everyday Git tools:** Stage, unstage, commit, fetch, pull, push, switch branches, manage worktrees, and safely discard tracked unstaged changes.
- **Durable sessions:** Keep active terminal and SSH work running when the window closes, or stop it before quitting.
- **AI agent awareness:** See when a supported terminal agent is running, ready, waiting for input, or finished without reading its transcript.
- **Fast navigation:** Search terminal output, launch actions from the command palette, save command snippets, and rebind every shortcut.
- **A workspace that feels like yours:** Choose from Tokyo Night, Dracula, One Dark, Solarized Light, and Gruvbox, then tune terminal typography and sidebar placement.

## Know when your agent needs you

JaneT can show live agent status in pane headers and tabs, including **Running**, **Needs input**, **Ready**, and completed turn outcomes. Status comes from explicit lifecycle events rather than transcript scraping, so no agent protocol text is added to the visible terminal.

Hermes Agent's classic terminal interface is supported through the included JaneT awareness plugin:

```bash
hermes plugins install Sjormz/JaneT/integrations/hermes-agent-awareness --enable
```

Restart any running Hermes sessions after installation. No JaneT configuration is required.

Other terminal agents continue to work normally in JaneT, but do not show agent-aware status until they provide a compatible lifecycle integration. Hermes TUI awareness is ready in the plugin and will be advertised once its required Hermes runtime fix is available in a public release.

## Build the workspace once

Split a tab into the layout your project needs, combine local and remote panes, then save it as a preset. Each pane can remember its own directory or SSH connection and run an ordered list of startup commands when a fresh workspace opens.

Presets work well for repeatable setups such as an app shell beside a test runner, several services in one grid, or a local project paired with its deployment host.

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

Save an SSH connection once and reopen it from the tab rail or a preset. JaneT pins host keys, reconnects restored SSH panes, and gives the focused remote terminal an SFTP-backed Explorer and editor.

A preset can combine local and SSH panes, so a project shell, log stream, and remote deployment session can share one saved layout.

## Download

Installers and portable builds are published on the [latest release](https://github.com/Sjormz/JaneT/releases/latest):

| Platform | Packages |
| --- | --- |
| Windows x64 | Installer and portable `.exe` |
| macOS Apple silicon and Intel | `.dmg` and `.zip` |
| Linux x64 | AppImage and Debian package |

JaneT checks GitHub Releases for updates from inside the app.

> [!NOTE]
> JaneT is under active alpha development. Current macOS releases are ad-hoc signed and not notarized, so Gatekeeper may require you to open JaneT explicitly from Finder. See the [release documentation](docs/release.md#macos-release-signing) for details.

## Default shortcuts

| Action | Shortcut |
| --- | --- |
| Command palette | `Ctrl+K` |
| New terminal tab | `Ctrl+N` |
| Search terminal output | `Ctrl+F` |
| Toggle workspace tools | `Ctrl+B` |
| Open snippets | `Ctrl+Shift+P` |
| Split pane right | `Ctrl+\` |
| Split pane below | `Ctrl+Shift+\` |

All shortcuts can be changed in Settings.

## Build from source

JaneT requires Node.js 22.12 or newer.

```bash
git clone https://github.com/Sjormz/JaneT.git
cd JaneT
npm install
npm run dev
```

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
