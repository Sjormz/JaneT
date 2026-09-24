---
title: Getting started
description: Download JaneT, choose where new workspaces live, and open your first project.
---

# Getting started

JaneT brings local terminals, project files, and everyday Git tools into one desktop workspace.

## Install and open JaneT

Download the package for your computer from [JaneT Releases](https://github.com/Sjormz/JaneT/releases/latest), then open JaneT.

- **Windows x64:** Choose the installer or portable `.exe`. Windows builds are unsigned, so SmartScreen may ask you to confirm the download. Verify that it came from the JaneT release before proceeding.
- **macOS 13 Ventura or later, Apple silicon:** Choose the `.dmg` or `.zip`. Release builds are signed with Apple Developer ID and notarized. Move JaneT to Applications from the DMG.
- **Linux x64:** Choose the AppImage or Debian package. Install the `.deb` with your package manager. For an AppImage, mark it executable before opening it.

For an AppImage, run `chmod +x JaneT-<version>-linux-x64.AppImage` and then `./JaneT-<version>-linux-x64.AppImage` from the download directory.

## Choose where new workspaces live

On first launch, JaneT asks you to choose a main directory. This is the parent folder for new temporary workspaces and projects; choosing it does not create a workspace or move existing files.

1. Select **Choose main directory** and choose a folder for new work.
2. Or select **Skip for now** if you plan to open an existing folder from Library. You can set the main directory later by selecting **Workspaces** in the side panel.

![First launch setup offering a main directory or a skip option](/screenshots/optional-workspace-setup.png)

*Choose a main directory now or set one later.*

![Workspaces side panel prompting for a main directory](/screenshots/workspace-setup-sidebar.png)

*The Workspaces side panel lets you finish setup later.*

## Create a workspace and project

1. Select **New workspace** in the Workspaces side panel and enter a workspace name.
2. In the new workspace, open its context menu and select **Add project**.
3. Enter a project name. To open terminals immediately, select **Add terminals**, choose the initial count and launcher, then select **Create project**. Terminals are optional; you can create the project first and open a session later.

![Create workspace dialog asking for a name](/screenshots/workspace-creation.png)

*A workspace is a folder under the main directory.*

![JaneT project creation form with initial terminal options](/screenshots/project-creation.png)

*Add terminals during project setup or start them later from the project.*

![JaneT workspace sidebar with projects and a terminal session](/screenshots/workspace-overview.png)

*The Workspaces sidebar groups project folders and their terminal sessions.*

To work in a folder that already exists, select **Add Library entry** beside Library and choose the folder. Library links use the existing directory in place; they do not copy it or create an isolated worktree.

JaneT saves workspace structure and pane layouts automatically. When you reopen the app, saved sessions start fresh local shells; shell process state is not restored. See [Workspaces and Library](/guide/workspaces) for folder, project, and session details, and [Terminals and panes](/guide/terminals) to arrange your shell workspace.
