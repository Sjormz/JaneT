---
title: Settings
description: Change JaneT's appearance, workspace tools position, notifications, and keyboard shortcuts.
---

# Settings

Select the gear-shaped **Settings** button in the title bar to open appearance, notification, diagnostics, and shortcut controls. JaneT saves changes as you make them.

![JaneT Settings panel with theme, text size, position, notifications, diagnostics, and shortcuts](/screenshots/settings-overview.png)

*The Settings panel groups appearance and behavior controls.*

## Change appearance

- **Theme**: choose Tokyo Night, Dracula, One Dark, Solarized Light, or Gruvbox (Dark).
- **Terminal and editor text size**: drag the slider to choose a size from 10 to 24 pixels. The default is 14 pixels.
- **Project tools position**: place the workspace and project tools on the left or right.

## Get background notifications

Notifications are off by default. Enable **Notify when Codex needs input or finishes, or long commands finish** to receive desktop alerts while JaneT is unfocused. A tracked Codex permission request or completed turn can alert immediately. Other tracked commands must run for at least 10 seconds. Select a notification to return to its terminal. JaneT's notification integration and your operating system's notification settings both affect delivery.

![Settings notification switch for Codex activity and long commands, beside the delivery check](/screenshots/notification-settings.png)

*One switch controls Codex activity and long-command alerts.*

Select **Check notification delivery** to check whether desktop notifications are available and whether JaneT has observed a delivery failure. A supported result does not override operating-system notification permissions or Do Not Disturb settings.

## Change keyboard shortcuts

Select **Keyboard shortcuts** at the bottom of Settings to open the shortcut list. See [Keyboard shortcuts](/reference/shortcuts) for the platform defaults and editing instructions.

## Copy diagnostics

Select **Copy diagnostics** to copy JaneT's version, operating system, architecture, app mode, Electron version, and notification support status. It does not include terminal text or file contents. Review the copied details before sharing them.
