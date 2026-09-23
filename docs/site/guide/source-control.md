---
title: Source Control
description: Review repository status, stage changes, commit, sync, manage branches, and use Git worktrees.
---

# Source Control

JaneT's **Source Control** panel follows the repository for the focused local terminal. It provides common Git operations alongside the terminal; Git itself must be available on the system.

![JaneT Source Control panel with staged and unstaged changes alongside terminals](/screenshots/source-control.png)

*Repository status, changed files, and Git actions appear beside the active terminal.*

## Review and stage changes

1. Focus a terminal whose current directory is inside the repository.
2. Open the workspace tools and select **Source Control**.
3. Review the current branch, changed-file count, and ahead/behind indicators.
4. Select a changed file to inspect its diff.
5. Use the file action to stage a file, or use **Stage all changes**. Review **Staged Changes**, then unstage individual files or all staged changes if needed.

Enter a message and choose **Commit staged changes** to commit only what is staged. JaneT does not automatically stage unstaged files for a commit.

## Fetch, pull, and push

Use the toolbar buttons at the top of Source Control:

- **Fetch** downloads remote updates and prunes stale remote references. It does not merge them into your current branch.
- **Pull** runs `git pull --ff-only`. If Git cannot fast-forward, use the terminal to decide how to integrate the changes.
- **Push** sends the current branch to its configured upstream. Configure remotes and credentials with Git or your credential manager.

## Create and switch branches

Use the **Branches** section to switch to a listed local branch or create a branch. Creating a branch checks it out immediately; you can optionally choose a start point. JaneT will not switch branches when Git refuses, for example when local changes would be overwritten.

Delete a branch from its row. The safe delete is the default; JaneT asks you to type `FORCE` before attempting to delete an unmerged branch. The current branch cannot be deleted from this panel.

## Create and manage worktrees

In **Worktrees**, select **Add worktree with new branch** or **Add worktree from existing branch**, then provide a branch and destination directory. New worktrees are separate directories backed by Git; unlike a Library session, they provide isolated working trees.

Select a worktree to open or focus its terminal. Removing a worktree deletes its directory; the default safe removal can be blocked by local changes. Type `FORCE` only when you intend to remove it despite those changes. **Prune stale worktrees…** removes Git records for missing directories; it does not delete working directories. **Worktree defaults** lets you set the suggested parent directory and folder-name template.

## Discard or delete carefully

The discard action restores tracked unstaged content from Git. It cannot be undone. Staged content and untracked files are preserved. Deleting an untracked item permanently removes it from disk; Git has no saved version to restore. Read the confirmation before proceeding.

JaneT exposes everyday status, staging, commit, fetch/pull/push, branch, and worktree operations. Use the terminal for operations that the panel does not provide, such as reset, rebase, or force push.
