# Terminal graphics

The shared xterm image addon handles direct Kitty graphics in local and SSH
panes. JaneT keeps `TERM=xterm-256color` and `TERM_PROGRAM=JaneT` for portable
terminal identity and does not fabricate a Kitty window ID. The generated
`codex` shell command scopes `TERM=xterm-kitty` to that child process only,
because current Codex auto-detection does not recognize JaneT even though the
JaneT xterm image addon accepts the direct Kitty image stream. Other commands
keep the portable JaneT identity.
See [Codex's pet capability detection](https://github.com/openai/codex/blob/main/codex-rs/tui/src/pets/image_protocol.rs).

Windows uses node-pty's bundled ConPTY because older OS ConPTY versions discard
Kitty APC sequences. A regression exercises queries, chunked image transmission
and deletion through an actual local PTY:

```sh
npm run build
npx playwright test --config playwright.config.ts tests/e2e/terminal-graphics.spec.ts
```

Kitty support requires pinned xterm prerelease packages. It is not full Kitty
protocol conformance: the addon lacks animation commands, filesystem/shared-memory
transfers and complete placement/deletion semantics. JaneT uses the addon's
direct image path; Unicode placeholder placements (`U=1`) are unsupported and
not interpreted. SIXEL and iTerm images are disabled.
Multiplexers still need their own passthrough support; Codex's automatic pet
protocol selection rejects tmux and Zellij.

Images are limited to 16,777,216 pixels each, an 8 MiB Kitty image-size limit and 32 MB of
addon storage per terminal.

The renderer's `script-src` CSP permits `wasm-unsafe-eval` for the packaged
WebAssembly base64 decoder. JavaScript `eval` and new remote script sources
remain blocked.
