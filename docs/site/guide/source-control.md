---
title: Source Control
description: Review repository status, stage changes, commit, sync, manage branches, and use Git worktrees.
---

# Source Control

JaneT's **Source Control** panel follows the repository for the focused local terminal. It provides common Git operations alongside the terminal; Git itself must be available on the system. It uses the same local directory as Explorer, so directories reported from an SSH session or a network share are not followed; see [How Explorer follows the terminal](/guide/files-editor#how-explorer-follows-the-terminal).

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

## When Git fails

When a Git action fails, the message below the branch line starts with **Git action failed:** followed by Git's own explanation. Examples include a missing commit identity, an authentication error, a branch with unmerged work, or a repository Git does not trust. JaneT removes credentials and terminal control codes from the message and shortens very long output.

- **Status cannot be read.** If Git cannot read the repository when the panel first loads, Source Control shows **Couldn't read Git status** with the reason and a **Retry** button instead of an empty or clean panel.
- **Status stops refreshing.** If a later refresh fails, the panel keeps the last known changes under a **Showing the last known status** notice with the reason and **Retry**. It does not report **Working tree clean** from an old snapshot. The branch in the status bar is dimmed with a warning icon, and its tooltip starts the reason with **Out of date:**. **Revert changes**, **Discard all unstaged changes**, and **Delete untracked item** are hidden until Git answers again.
- **Git does not respond.** JaneT stops waiting for Git after 20 seconds without output while reading status, 60 seconds for local actions such as staging, or 5 minutes for commit, branch switching, worktree creation, fetch, pull, and push. The message says Git may be waiting for credentials, a hook, or the network. Git can sometimes finish in the background after JaneT stops waiting, so refresh and check the repository before you retry.
- **Invalid names are rejected before Git runs.** Branch names must follow Git's branch-name rules. For example, they cannot contain spaces or `..` or end with `.lock`. Branch names, start points, and worktree folders cannot begin with `-`.

## Discard or delete carefully

The discard action restores tracked unstaged content from Git. It cannot be undone. Staged content and untracked files are preserved. Deleting an untracked item permanently removes it from disk; Git has no saved version to restore. Read the confirmation before proceeding.

JaneT exposes everyday status, staging, commit, fetch/pull/push, branch, and worktree operations. Use the terminal for operations that the panel does not provide, such as reset, rebase, or force push.
