---
title: Local data and privacy
description: Understand what JaneT saves and what leaves the app.
---

# Local data and privacy

JaneT is a local desktop app. It launches local shell processes, reads files you open, and runs Git operations in repositories you select. The app does not require a JaneT account or cloud workspace.

## Saved on this computer

JaneT saves settings and workspace structure in its Electron user-data directory. That includes layout, project and session paths, theme, shortcuts, snippets, notification preferences, and recent command history. Command history stores command text, timing, outcome, and working directory, but not terminal output. Closing the app ends managed terminal processes; reopening it starts fresh shells in the saved structure.

Editor documents are files on your disk. JaneT does not turn them into a separate synced copy. A copied or dragged image can be written to a temporary local file so a terminal application can receive its path.

## Outside the app

JaneT checks GitHub Releases for updates. A Git fetch, pull, or push uses the remote configured for that repository. Commands and agent CLIs you run in a terminal have their own network and data behavior; consult their documentation before using them with sensitive material.

Codex and Hermes activity integration passes bounded lifecycle information to JaneT. It does not send prompt text, tool input or output, transcript paths, or assistant messages into JaneT's activity bridge. Existing agent notification handlers remain under the agent's own configuration.

## Screenshots and support reports

Terminal content, file paths, and repository names can be sensitive. Review screenshots and logs before sharing them in an issue. The screenshots in these guides are generated from a disposable example profile, not a user's working data.
