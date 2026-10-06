---
title: Workspaces and Library
description: Organize projects in temporary Workspaces or in Library entries linked to your own folders.
---

# Workspaces and Library

Everything in JaneT's sidebar is a **project**: a named set of terminals with its own pane layout. Projects live in one of two places, which treat your files differently.

| | Workspaces | Library |
| --- | --- | --- |
| Holds | Workspaces, each a folder that JaneT manages | Library entries, each a folder you link |
| A project is | A folder directly inside the workspace | A named set of terminals that opens in the entry's folder, or in a Git worktree |
| Renaming a project | Renames its folder on disk | Changes only its name in JaneT |
| Removing | **Delete project…** sends the folder to the Recycle Bin/Trash | **Remove project…** forgets the project; files are never touched |
| Use it for | Experiments and scratch work | Real code, repositories, and anything JaneT must not move |

![JaneT Workspaces sidebar with the Choose existing workspace control, workspace groups, and projects](/screenshots/workspace-overview.png)

*The sidebar lists workspaces and Library entries with their projects; select a project to show its terminals.*

## Set a home for temporary work

1. On first launch, choose **Choose main directory** and select a parent folder. Choose **Skip for now** if you only want to use Library; you can set the directory later from **Workspaces** in the side panel.
2. Select **New workspace** to create a workspace folder beneath that parent.
3. Give the workspace a name. Right-click its heading and choose **Add project**.
4. Name the project. JaneT creates the project folder inside the workspace. You can add terminals now or create the project without terminals and start them later.

The main directory is only the default location for new workspaces. Changing it does not move existing workspace folders or Library folders. Choosing it does not create folders by itself.

![Create project dialog with a project name and initial terminal options](/screenshots/project-creation.png)

*The project form lets you choose the initial terminal count and a shared launcher.*

## Create a project from the keyboard

Press **New project** (`Ctrl+Shift+T` on Windows and Linux, `Cmd+T` on macOS) to open **Create project** for the Workspace or Library entry that holds the current project. Without a current project, JaneT uses the first workspace, then the first Library entry. If there is neither, it starts the normal setup. **New project** is also in the command palette.

## Choose an existing workspace

1. In the **Workspaces** sidebar, select **Choose existing workspace**. On first launch, select **Skip for now** if you do not want to set a main directory.
2. Choose a folder to use as the workspace. JaneT adds each folder directly inside it as a project, even if that project has no terminals yet.
3. Select a project and use **Start terminals** when you want terminals in its folder. Folders deeper inside a project stay part of that project; they do not become separate projects. Files directly in the workspace folder stay there and do not appear as projects.

Linked Git worktree folders directly inside the selected workspace become separate Library entries. Importing requires one free entry for the workspace and one for each worktree; if there is not enough room, remove an unused entry and try again. No folders are moved.

![Workspaces sidebar showing two projects created from the selected folder's direct subfolders](/screenshots/existing-workspace-projects.png)

*Choosing an existing workspace adds its direct subfolders as projects, ready for terminals.*

Choosing a workspace does not move, copy, or change its files. The chosen folder and its ordinary projects become managed by Workspaces: **Rename** changes folder names on disk, and **Delete workspace…** or **Delete project…** sends those folders and their contents to the OS Recycle Bin/Trash after confirmation. Use **Library** if you want to link a folder without making it managed workspace storage. JaneT supports up to 64 saved projects, so a workspace with more folders than the available slots cannot be added.

Choose a real folder; JaneT does not add linked workspace roots or linked child folders as projects.

## Link a folder to Library

Use a Library entry when you want to work in an existing repository or directory without JaneT ever moving, renaming, or deleting it:

1. Select **Add Library entry** beside the Library heading.
2. Choose the existing folder.
3. Right-click the Library entry and choose **Add project** to create a named set of terminals that open in that folder.

A Library entry can hold several projects, for example one for a dev server and one for tests. They share the linked folder; they are not copies and do not create isolated Git worktrees.

## Open a Git worktree as a project

In **Source Control**, select a worktree that has no open terminal. JaneT opens it as a **Library project** whose terminals start in the worktree folder. The project shows a **w** badge (read aloud as "Worktree project"):

- If the repository is in a Library entry, the worktree becomes another project of that entry.
- If the repository is a Workspace project, JaneT adds a Library entry for the worktree folder with one project in it. Worktrees always stay on the Library side, so JaneT never renames or deletes them.

![Library section of the sidebar with a review entry holding a review project marked with a w worktree badge](/screenshots/worktree-library-project.png)

*A worktree of a Workspace project opens as its own Library entry, marked as a worktree project.*

If a project for that worktree already exists, JaneT selects it instead. Removing a worktree project, or its Library entry, leaves the worktree on disk; use **Remove worktree** in Source Control to delete it. See [Create and manage worktrees](/guide/source-control#create-and-manage-worktrees).

## Start and close terminals

When creating a project, **Add terminals** is optional. If enabled, choose 1–16 initial terminals and select **Terminal**, **Codex**, **Hermes**, **Claude**, or **Custom**. The same launcher and startup command apply to every initial terminal. For **Custom**, JaneT runs the command in each terminal; do not put passwords or tokens in it.

A project without terminals shows **Start terminals** in place of its terminal layout. To add terminals to a project that already has some, select **Add terminals** (the **+** button) on a pane, or press **Add terminals to current project** (`` Ctrl+Shift+` ``). See [Terminals and panes](/guide/terminals).

Projects outlive their terminals. Closing the last terminal pane, or choosing **Close all terminals…** from the project's context menu, stops the shells but keeps the project, its folder, its open editors, and its place in the sidebar. Detached jobs may continue outside JaneT.

## Rename, keep, remove, or delete

Right-click a workspace, Library entry, or project in the sidebar.

- **Rename project** on a Workspace project also renames its folder on disk and updates JaneT's saved paths. On a Library or worktree project it changes only the name shown in JaneT. **Rename workspace** renames the workspace folder.
- **Keep in Library…** (Workspace projects only) promotes the project to a destination outside temporary storage. JaneT copies the project, verifies the copy, adds a Library entry, and then sends the original to the OS Recycle Bin/Trash. Save editor changes and stop external processes that may be writing files first. Existing destinations are not merged or overwritten; symlinks cannot be promoted automatically.
- **Remove project…** (Library projects, worktree projects, and any project that does not own a workspace folder) stops the project's terminals and removes it from JaneT. It does not touch any file or folder.
- **Remove from Library…** unlinks a Library entry and stops its terminals. It does not delete the folder or its files.
- **Delete workspace…** or **Delete project…** (Workspaces only) asks for confirmation, then sends the managed folder to the OS Recycle Bin/Trash. Check the confirmation before proceeding.

JaneT refuses to rename, move, or delete a folder that is a Git worktree or submodule, or that contains one at any depth, even inside a workspace. It also protects folders that overlap a Library entry; renaming a folder containing a Library project is blocked too. If JaneT cannot inspect a folder safely, the action stops and the files stay in place. Use Git to remove worktrees or submodules before moving their parent folders.

**Keep in Library…** and **Delete…** stop the affected terminals before touching files. If the operation then fails, JaneT leaves the files in place, shows the reason, and starts fresh terminals in the stopped panes at their last known folders. Startup commands configured for those panes run again, as they do after restarting JaneT.

If a linked folder is unavailable, select **Locate folder** beside it and choose its current location. This updates the link without moving its files.

## Show or hide the workspace list

Select **Collapse workspace list** (the sidebar button beside **New workspace**) to hide the list and give your terminals more room. To bring it back, select **Show workspace list**, the sidebar button next to the JaneT name in the title bar. In narrow windows, JaneT hides the list automatically; the same title-bar button reopens it. **Previous project** and **Next project** (`Ctrl+Shift+Tab` and `Ctrl+Tab`) switch projects while the list is hidden.

The project tools (Explorer and Source Control) collapse to an icon strip with the button at the bottom of that strip.

## Restore your working layout

JaneT saves workspaces, Library entries, projects, pane layouts, and terminal directories automatically. If you remove every project, JaneT keeps the empty state after restart until you create or open work again.

Closing JaneT ends its managed local terminals. Restarting restores the saved workspace structure into fresh shells, and configured startup commands run again. Save editor changes and finish foreground terminal tasks before closing.

If editor files have unsaved changes when you close JaneT, quit, or install an update, JaneT asks whether to **Save all and close**, **Discard changes and close**, or **Cancel**. The prompt waits for your choice for as long as it is open. If that close request has already ended when you choose, JaneT closes the prompt, keeps running, and says so; any files you chose to save are saved, and you can close or install the update again.

## Updating from earlier versions

Versions of JaneT up to 0.14.1 could also save sidebar entries that were not projects, such as a terminal opened with the old **New terminal tab** shortcut or a worktree opened from Source Control. The first time a newer version starts, it folds each of them into a project once, without touching any files:

- Its terminals join the project in the same Workspace or Library entry whose folder matches the entry's folder (or contains it), otherwise the first project there. Each terminal keeps its title, folder, and startup commands. Existing projects keep their own terminals before any older entries are merged, regardless of the order they were saved in. The limit is 64 terminals across the app; older entries use the remaining slots in saved order, and extra terminals are left out.
- In a Library entry with no project yet, the first such entry becomes its project, and later ones join it.
- In a workspace with no project yet, an entry for a folder directly inside the workspace becomes that folder's project. Any other entry that has terminals becomes a project that owns no folder, so renaming it changes only its name and removing it never touches files. An entry with neither terminals nor a folder is dropped.
- An entry whose folder is a Git worktree becomes a worktree project in Library, including worktrees previously saved as Workspace projects. If all 64 workspace and Library entries are occupied, its terminals join another project in the same workspace; if there is no other project, JaneT reuses that workspace entry as a Library entry for the worktree. These fallbacks keep worktree folders protected and never move files.
