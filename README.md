# JaneT

A powerful, cross-platform terminal with built-in file explorer, SSH remote file browsing, and git tree visualization.

Built by sjorm, for sjorm.

## Features

- **Terminal Emulator** - Full-featured terminal with xterm.js and node-pty
- **Multiple Tabs** - Open many terminals in one window
- **File Explorer** - VS Code-style file tree sidebar with breadcrumb navigation
- **SSH Connection Manager** - Connect to remote servers with password or key auth
- **SSH Remote File Browser** - Browse remote filesystems via SFTP
- **Git Integration** - See branches, status, file changes, and switch branches
- **Drag & Drop** - Drag files from explorer into terminal (pastes the path)
- **Tokyo Night Theme** - Beautiful dark theme inspired by Tokyo Night
- **Cross-Platform** - Windows, macOS, Linux

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
│   │   ├── ssh.ts         # SSH/SFTP connection management
│   │   ├── filesystem.ts  # Local file system operations
│   │   └── git.ts         # Git repository operations
│   └── renderer/          # React frontend
│       ├── App.tsx         # Main app layout & state
│       ├── components/
│       │   ├── TabBar.tsx        # Tab management
│       │   ├── TerminalPane.tsx  # xterm.js terminal
│       │   ├── Sidebar.tsx       # Sidebar container
│       │   ├── FileExplorer.tsx  # File tree navigation
│       │   ├── SSHManager.tsx    # SSH connection UI
│       │   ├── GitTree.tsx       # Git visualization
│       │   └── StatusBar.tsx     # Status bar
│       └── styles/
│           └── global.css  # Tokyo Night theme
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
- **Tokyo Night** - Color scheme

## Building for Distribution

```bash
npm run dist
```

This creates platform-specific installers in the `release/` directory.

Public releases are built by GitHub Actions from `vX.Y.Z` tags. See
[docs/release.md](docs/release.md) for the release checklist.

## Coming Soon

- Split panes (multiple terminals in one tab)
- Enhanced drag & drop (file transfer via SCP/SFTP)
- Remote file tree auto-refresh on SSH connect
- SSH config file parsing (~/.ssh/config)
- Customizable themes
- Terminal search

## License

MIT
