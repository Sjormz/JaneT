---
title: Terminal graphics
description: What JaneT can display from applications using the Kitty image protocol.
---

# Terminal graphics

JaneT can display images sent by compatible terminal applications through a subset of the Kitty graphics protocol. This includes direct PNG images, chunked transmission, queries, and image deletion. Local terminals advertise a Kitty-compatible graphics identity so supported applications can choose that path automatically.

This is not full Kitty terminal emulation. Animation commands, file or shared-memory transfers, Unicode placeholder placement, and some placement and deletion operations are unsupported. SIXEL and iTerm image protocols are disabled. Terminal multiplexers such as tmux need their own passthrough support and may prevent an application from choosing Kitty graphics.

Each image is limited to 16,777,216 pixels and 8 MiB, with 32 MB of image storage per terminal. If an application cannot display its image, use its text fallback or run it outside a multiplexer. See the [technical graphics note](https://github.com/Sjormz/JaneT/blob/main/docs/terminal-graphics.md) for the tested protocol scope.
