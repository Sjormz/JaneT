<p align="center">
  <img src="assets/brand/app-icon.svg" width="96" height="96" alt="JaneT Prompt-J mark">
</p>

# JaneT

A focused terminal workspace for local and SSH work, with durable sessions, file browsing, and Git context built in.

## Features

- **Local terminals** — Run full PTY-backed shells with xterm.js and node-pty.
- **Tabs and split panes** — Arrange multiple terminals in one window and save reusable launch presets.
- **Local and remote Explorer** — Browse local folders or a connected SSH machine through SFTP.
- **SSH connections** — Save password or private-key profiles and reconnect in one step.
- **Durable workspaces** — Keep active terminals and SSH sessions running after the window closes, or stop them before quitting.
- **Source Control** — See branches, worktrees, conflicts, and file changes without leaving the terminal.
- **Drag and drop** — Drag a file into the terminal to paste its escaped path.
- **Five readable themes** — Choose Tokyo Night, Dracula, One Dark, Solarized Light, or Gruvbox.
- **Cross-platform desktop app** — Use the same workspace on Windows, macOS, and Linux.

## Quick Start

Prerequisite: Node.js 22.12 or newer.

```bash
# Install dependencies
npm install

# Build and run
npm run build
npm start
```

### Development Mode

```bash
npm run dev
```

This starts the Vite dev server for hot-reload, then launches Electron.

### Background workspaces

When JaneT detects active local terminal processes or an open SSH shell, closing the window offers three choices:

- **Keep running in background** hides JaneT while preserving the exact panes, processes, connections, and terminal output. Reopen it from the tray, the macOS Dock, or by launching JaneT again; a second launch restores the existing workspace instead of creating a competing instance.
- **Stop all and quit** interrupts JaneT-owned local work, terminates and verifies surviving child processes, closes SSH sessions, and quits. If JaneT cannot confirm that a local process stopped, it stays open and reports the survivor so Stop can be retried.
- **Cancel** returns to the workspace without changing anything.

Idle local shells close normally without an extra prompt. This first durable-workspace release keeps the JaneT Electron process alive in the background; it does not preserve local processes through a force-quit, operating-system restart, or machine shutdown. Remote jobs deliberately detached with tools such as `tmux`, `nohup`, `systemd`, or `disown` may continue after JaneT closes its SSH connection.

## Contributing

Public contributions are welcome. Please see:

- [CONTRIBUTING.md](CONTRIBUTING.md) for setup and PR expectations
- the pull request template for the information reviewers need
- the issue templates for bugs and feature requests

## Architecture

```
janet/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # App entry, IPC handlers
│   │   ├── preload.ts     # Context bridge (secure API)
│   │   ├── terminal.ts    # node-pty terminal management
│   │   ├── processInspector.ts # Running-work detection
│   │   ├── workspaceLifecycle.ts # Background/stop/close decisions
│   │   ├── ssh.ts         # SSH/SFTP connection management
│   │   ├── filesystem.ts  # Local file system operations
│   │   └── git.ts         # Git repository operations
│   └── renderer/          # React frontend
│       ├── App.tsx         # Main app layout & state
│       ├── components/
│       │   ├── Titlebar.tsx      # Brand, navigation, and command entry
│       │   ├── VerticalTabBar.tsx # Tabs and saved presets
│       │   ├── SplitPane.tsx     # Pane layout and resize controls
│       │   ├── TerminalPane.tsx  # xterm.js terminal
│       │   ├── Sidebar.tsx       # Sidebar container
│       │   ├── FileExplorer.tsx  # File tree navigation
│       │   ├── SSHManager.tsx    # SSH connection UI
│       │   ├── GitTree.tsx       # Git visualization
│       │   └── StatusBar.tsx     # Status bar
│       └── styles/
│           └── global.css  # Shared visual system and theme roles
├── scripts/dev.mjs         # Dev server launcher
├── vite.config.ts          # Vite bundler config
└── package.json
```

## Tech Stack

- **Electron** - Cross-platform desktop shell
- **React + TypeScript** - UI framework
- **xterm.js** - Terminal emulator (web-based)
- **node-pty** - Native PTY for local terminals
- **ssh2** - SSH/SFTP client (pure JS)
- **simple-git** - Git operations
- **Vite** - Frontend bundler
- **Lucide** — Shared interface icon system
- **Inter and JetBrains Mono** — Bundled UI and terminal typography

## Building for Distribution

```bash
npm run dist
```

This creates platform-specific installers in the `release/` directory.

Public releases are built by GitHub Actions from `vX.Y.Z` tags. See
[docs/release.md](docs/release.md) for the release checklist.

## Coming Soon

- Enhanced drag & drop (file transfer via SCP/SFTP)
- SSH config file parsing (~/.ssh/config)

## License

MIT
