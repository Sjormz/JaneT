---
title: Files and editor
description: Browse local project files, open text files, and save edits in JaneT.
---

# Files and editor

JaneT's **Explorer** follows the working directory of the focused local terminal. Browse the project, open supported text files in the built-in editor, and switch back to the terminal without leaving the session.

![JaneT built-in editor with a source file open beside the workspace tools](/screenshots/built-in-editor.png)

*The editor opens as a document surface alongside the terminal.*

## Browse a project

1. Focus a local terminal in the project you want to inspect.
2. Open the workspace tools with **Show or hide workspace tools** if they are hidden.
3. Select **Explorer**. Its starting directory follows the focused terminal's current directory.
4. Open folders, use **Back to previous folder**, or select **Browse parent folders** to navigate elsewhere.
5. Select **Show hidden files** when you need dotfiles or other hidden entries. Use **Refresh files** to reload the current folder.

Explorer lists local files and directories. Select a file to open it in the editor. Drag a file or folder into a compatible terminal to paste its escaped path; use the copy-path button beside an entry to put that path on the clipboard.

## Edit and save a text file

Select a file in Explorer to open it as a document tab. Edit the text, then choose **Save file** or use the editor's save shortcut. JaneT marks unsaved documents in the document tab. When closing a dirty document or session, review JaneT's prompt before discarding changes.

The editor accepts UTF-8 text files up to 2 MiB. It does not open binary files or files with invalid UTF-8 data. Git diff documents are previews and cannot be edited or saved as source files. JaneT uses Monaco's detected language support and applies the selected app theme and text size.

## Review a Git change

With a Git repository open in Source Control, select a changed file to view its diff. Use the diff view to inspect the change, then return to Explorer or the terminal surface. To edit the source file itself, open it from Explorer; the diff preview is read-only.

See [Source Control](/guide/source-control) for staging, commits, branches, and worktrees.
