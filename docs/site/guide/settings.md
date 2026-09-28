---
title: Settings
description: Change JaneT's appearance, transparency, workspace tools position, notifications, and keyboard shortcuts.
---

# Settings

Select the gear-shaped **Settings** button in the title bar. Settings is grouped into **Appearance**, **Layout**, **Notifications**, and **Advanced**. JaneT saves changes as you make them.

![JaneT Settings panel with theme, text size, position, notifications, diagnostics, and shortcuts](/screenshots/settings-overview.png)

*The Settings panel groups appearance and behavior controls.*

## Change appearance

- **Theme**: choose Tokyo Night, Dracula, One Dark, Solarized Light, or Gruvbox (Dark).
- **Terminal and editor text size**: drag the slider to choose a size from 10 to 24 pixels. The default is 14 pixels.
- **Transparency**: choose how much the title bar, sidebars, status bar, and floating panels show through. See [Transparency](#transparency).
- **Project tools position**: place the workspace and project tools on the left or right.

## Transparency

JaneT's title bar, sidebars, and status bar are translucent glass, and the command palette, menus, and dialogs blur what is behind them. Terminals and the editor are always solid, so their text is never see-through.

- **System** (default): full glass. On macOS the desktop shows through the window frame, and on Windows 11 (version 22H2 or later) JaneT uses the Mica material. If your operating system is set to reduce transparency, JaneT uses **Reduced** instead, and Settings says so.
- **Reduced**: thicker glass with a lighter blur, and a solid window, so the desktop no longer shows through.
- **Off**: solid surfaces everywhere, with no blur.

On Linux and earlier versions of Windows, the window itself stays solid, but panels and menus still use glass inside it. If your operating system's increased-contrast setting is on, JaneT always uses solid surfaces.

## Motion

Panels, menus, and selections animate briefly to show what changed. For example, collapsing a sidebar slides it away, and the highlighted tab glides to the new one. Terminal text never animates. To turn animation off, enable your operating system's reduce-motion setting: on macOS, **Reduce motion** in Accessibility > Display; on Windows, **Animation effects** in Accessibility > Visual effects. JaneT then changes views instantly.

## Get background notifications

Notifications are off by default. Enable **Notify when long commands finish** to receive desktop alerts while JaneT is unfocused. Tracked commands must run for at least 10 seconds. Select a notification to return to its terminal. JaneT's notification integration and your operating system's notification settings both affect delivery.

![Settings switch for long-command notifications beside the delivery check](/screenshots/notification-settings.png)

*The switch enables alerts for long-running commands.*

Select **Check notification delivery** to check whether desktop notifications are available and whether JaneT has observed a delivery failure. A supported result does not override operating-system notification permissions or Do Not Disturb settings.

## Change keyboard shortcuts

Select **Keyboard shortcuts** in the **Advanced** group of Settings to open the shortcut list. Shortcuts show as keys (on macOS, ⌘ ⌥ ⌃ ⇧); select one to record a new shortcut. See [Keyboard shortcuts](/reference/shortcuts) for the platform defaults and editing instructions.

## Copy diagnostics

Select **Copy diagnostics** to copy JaneT's version, operating system, architecture, app mode, Electron version, and notification support status. It does not include terminal text or file contents. Review the copied details before sharing them.
