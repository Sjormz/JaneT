---
title: Workspaces and Library
description: Create temporary projects or link existing folders in JaneT.
---

# Workspaces and Library

JaneT groups temporary projects under **Workspaces** and lets you link existing folders in the persistent **Library**. Both can hold terminal sessions, but they manage files differently.

![JaneT Workspaces sidebar with the Choose existing workspace control, workspace groups, and projects](/screenshots/workspace-overview.png)

*The sidebar keeps workspace groups, projects, and their sessions together.*

## Set a home for temporary work

1. On first launch, choose **Choose main directory** and select a parent folder. Choose **Skip for now** if you only want to use Library folders; you can set the directory later from **Workspaces** in the side panel.
2. Select **New workspace** to create a workspace group beneath that parent.
3. Give the workspace a name. Right-click its heading and choose **Add project**.
4. Name the project. JaneT creates a project folder inside the workspace. You can add terminals now or create the project without terminals and start a session later.

The main directory is only the default location for new temporary workspaces. Changing it does not move existing workspace folders or Library folders. Choosing it does not create folders by itself.

![Create project dialog with a project name and initial terminal options](/screenshots/project-creation.png)

*The project form lets you choose the initial terminal count and a shared launcher.*

## Choose an existing workspace

1. In the **Workspaces** sidebar, select **Choose existing workspace**. On first launch, select **Skip for now** if you do not want to set a main directory.
2. Choose a folder to use as the workspace. JaneT adds each folder directly inside it as a project, even if that project has no terminals yet.
3. Select a project and use **Add terminals** when you want a session in its folder. Folders deeper inside a project stay part of that project; they do not become separate projects. Files directly in the workspace folder stay there and do not appear as projects.

![Workspaces sidebar showing two projects created from the selected folder's direct subfolders](/screenshots/existing-workspace-projects.png)

*Choosing an existing workspace adds its direct subfolders as projects, ready for terminals.*

Choosing a workspace does not move, copy, or change its files. The chosen folder and its projects become managed by Workspaces: **Rename** changes folder names on disk, and **Delete workspace…** or **Delete project…** sends those folders and their contents to the OS Recycle Bin/Trash after confirmation. Use **Library** if you want to link a folder without making it managed workspace storage. JaneT supports up to 64 saved projects and sessions, so a workspace with more folders than the available slots cannot be added.

Choose a real folder; JaneT does not add linked workspace roots or linked child folders as projects.

## Start a project or session

When creating a project, **Add terminals** is optional. If enabled, choose 1–16 initial terminals and select **Terminal**, **Codex**, **Hermes**, **Claude**, or **Custom**. The same launcher and startup command apply to every initial terminal. For **Custom**, JaneT runs the command in each terminal; do not put passwords or tokens in it.

In Workspaces, the terminal icon starts a local terminal in the project folder. Right-click a project and choose **Close all terminals…** to stop its current shells while retaining its folder and saved project. Closing JaneT ends its managed local terminal sessions; when you reopen JaneT, the saved sessions start fresh shells and configured startup commands run again. Detached jobs may continue outside JaneT.

Use a linked Library folder when you want to work in an existing repository or directory without moving or copying it:

1. Select **Add Library entry** beside the Library heading.
2. Choose the existing folder.
3. Right-click the Library entry and choose **Add project** to create a named session with 1–16 terminals in that same folder.

Library sessions share the linked folder. They are not copies and do not create isolated Git worktrees. To create a worktree, use Source Control.

## Rename, move, remove, or delete

Use the context menu on a workspace or project in the sidebar. Renaming a managed workspace or project also renames its folder on disk and updates JaneT's saved paths. Library session names are labels; they do not rename the linked folder.

- **Close session** stops that session's terminals and keeps its files. A project may offer **Close all terminals…** when it contains multiple panes.
- **Keep in Library…** promotes a managed project to a destination outside temporary storage. JaneT copies the project, verifies the copy, adds a Library entry, and then sends the original to the OS Recycle Bin/Trash. Save editor changes and stop external processes that may be writing files first. Existing destinations are not merged or overwritten; symlinks cannot be promoted automatically.
- **Remove from Library…** unlinks the folder and stops its sessions. It does not delete the folder or its files.
- **Delete workspace…** or **Delete project…** asks for confirmation, then sends managed files to the OS Recycle Bin/Trash. Check the confirmation before proceeding.

If a linked folder is unavailable, select **Locate folder** beside it and choose its current location. This updates the link without moving its files.

## Restore your working layout

JaneT saves workspace groups, projects, sessions, pane layouts, and terminal directories automatically. If the last session is closed, JaneT keeps the empty state after restart until you create or open work again.

Closing JaneT ends its managed local terminal sessions. Restarting restores the saved workspace structure into fresh shells, and configured startup commands run again. Save editor changes and finish foreground terminal tasks before closing.
