---
title: Troubleshooting
description: Resolve common JaneT workspace, notification, settings, and update issues.
---

# Troubleshooting

## JaneT opens to an empty workspace

JaneT does not create starter workspaces or projects automatically. To create temporary work, choose a main directory, select **New workspace**, then add a project. To use an existing folder, select **Add Library entry** beside Library. See [Getting started](/getting-started) and [Workspaces and Library](/guide/workspaces).

## A notification did not appear

Open **Settings** and check **Notify when long commands finish**. Notifications are off by default, JaneT must be unfocused, and tracked commands must run at least 10 seconds. Codex turn and approval alerts are currently unavailable; see [Agent activity](/guide/agent-activity). Select **Check notification delivery** in Settings. If notifications are supported, check your operating system's app notification permissions and Do Not Disturb settings. Commands in unsupported shells may not report reliable command completion; see [Terminals and panes](/guide/terminals#navigate-completed-commands).

## JaneT says it could not load workspace settings

At startup, choose **Try again** to retry loading. If it is offered, **Restore previous** restores the prior saved settings. **Use defaults** replaces the unreadable settings file, including saved tabs and custom shortcuts; JaneT asks you to confirm before doing this.

## An update failed

Use **Retry** in the update notice. If it fails again, choose **View JaneT releases** to download a release manually. JaneT also reports when it is up to date and when a downloaded update is ready to install.

## Send useful diagnostics

Open **Settings** and choose **Copy diagnostics**, then review the copied details before sharing them. The diagnostics contain JaneT's version, operating system, architecture, app mode, Electron version, and notification support status; they do not include terminal text or file contents. For a bug report, include the steps you took, what you expected, what happened, your JaneT version, and your operating system. Use GitHub's [private security advisory flow](https://github.com/Sjormz/JaneT/security/advisories/new) for security-sensitive reports.
