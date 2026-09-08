# Terminal graphics

The shared xterm image addon handles direct Kitty graphics in local and SSH
panes. JaneT advertises `KITTY_WINDOW_ID` in local terminals and integrated
remote Bash shells, while retaining `TERM=xterm-256color` for portable terminfo.
Other remote shells can use protocol queries; clients relying only on environment
hints may need `export KITTY_WINDOW_ID=janet-ssh` in that remote shell.

Windows uses node-pty's bundled ConPTY because older OS ConPTY versions discard
Kitty APC sequences. A regression exercises queries, chunked image transmission
and deletion through an actual local PTY:

```sh
npm run build
npx playwright test --config playwright.config.ts tests/e2e/terminal-graphics.spec.ts
```

Kitty support requires pinned xterm prerelease packages. It is not full Kitty
protocol conformance: the addon lacks animation commands, filesystem/shared-memory
transfers and complete placement/deletion semantics. JaneT retains its bounded
Unicode PNG placement fallback for Hermes. SIXEL and iTerm images are disabled.
Multiplexers still need their own passthrough support; Codex disables pets in tmux.

Images are limited to 16 million pixels, 8 MiB per Kitty sequence and 32 MiB of
addon storage per terminal. The older Unicode fallback has its own smaller bounds.

The renderer's `script-src` CSP permits `wasm-unsafe-eval` for the packaged
WebAssembly base64 decoder. JavaScript `eval` and new remote script sources
remain blocked.
