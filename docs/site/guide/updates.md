---
title: Updates
description: Check, download, and install JaneT releases.
---

# Updates

JaneT checks GitHub Releases for a newer version after the installed app starts. It does not automatically download an update.

## Check manually

Select the version in the status bar to check for updates, or open the command palette and choose **Check for updates**. JaneT reports whether it is up to date or displays an available version.

![JaneT command palette where app actions can be searched](/screenshots/command-palette.png)

*Search for Check for updates in the command palette.*

## Download and install

1. When the update banner offers a newer version, choose **Download update**.
2. Wait for the download to finish. The banner shows progress and then **Restart to install**.
3. Save any open editor changes and finish terminal work you need to keep. Choose **Restart to install** and follow JaneT's close confirmation if it appears.

JaneT restores its saved workspace structure after restarting, but managed shell processes end when the app closes. If an update fails or your package does not support in-app installation, choose **View JaneT releases** in the error banner and install the correct package from the [latest GitHub release](https://github.com/Sjormz/JaneT/releases/latest).

You can always check the installed version in the status bar. Development builds are not a replacement for a published release package.
