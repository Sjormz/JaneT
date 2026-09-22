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

## Get long-command notifications

Notifications are off by default. Enable **Notify when long commands finish while JaneT is unfocused** to receive a desktop notification when a tracked command completes while the JaneT window is unfocused. The command must run for at least 10 seconds. JaneT's notification integration and your operating system's notification settings both affect delivery.

![Notification setting with its delivery check and ten-second threshold](/screenshots/notification-settings.png)

*The delivery check and notification toggle are together in Settings.*

Select **Check notification delivery** to check whether desktop notifications are available and whether JaneT has observed a delivery failure. A supported result does not override operating-system notification permissions or Do Not Disturb settings.

## Change keyboard shortcuts

Select **Keyboard shortcuts** at the bottom of Settings to open the shortcut list. See [Keyboard shortcuts](/reference/shortcuts) for the platform defaults and editing instructions.

## Copy diagnostics

Select **Copy diagnostics** to copy JaneT's version, operating system, architecture, app mode, Electron version, and notification support status. It does not include terminal text or file contents. Review the copied details before sharing them.
