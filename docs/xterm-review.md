# xterm stability review — 2026-09-16

Scope: renderer, local PTY, SSH transport, selection/clipboard, inline graphics,
resize, dependency patches and terminal configuration. Baseline: `e9abbc3`,
JaneT 0.11.1. This is a local review and change set, not a release or a claim of
complete terminal-protocol conformance.

## Findings and changes

| Priority / impact | Finding | Action | Practical effect / limitation |
| --- | --- | --- | --- |
| High: less custom rendering and incorrect state | A Hermes-specific Kitty `U=1` implementation duplicated parsing, image storage, buffer scanning and DOM rendering. It did not implement deletion or multiple placements correctly. | Removed the custom decoder and overlay from `src/renderer/kittyGraphics.ts`; retained the bounded upstream ImageAddon. | One rendering owner. Direct RGB/RGBA/PNG graphics remain; Unicode placeholder placements are unsupported. Clipboard image attachments are separate and remain. |
| High: correct terminal stream | Selection protection injected mouse-mode resets and regex-filtered PTY output before xterm parsed it. This made application-requested state diverge from xterm state. | Removed the mouse-mode filter, disable/restore sequences and dead suppression helper. | xterm receives the original output and owns VT parsing. Native modifier selection does not require changing the application's modes. |
| High: predictable input | Ordinary TUI drags created an invisible copy snapshot using custom coordinate calculations. Cached snapshots could survive a pane visit and intercept later copy/interrupt gestures. | Removed ordinary-drag shadow selection. Retained only text from an explicit native modifier selection, with cleanup on copy, input, new click and detach. | Mouse-aware TUIs own ordinary drags. Terminal selection uses Shift-drag on Windows/Linux and Option-drag on macOS. |
| Medium: truthful capabilities | Local and integrated SSH Bash shells advertised invented `KITTY_WINDOW_ID` values. That variable identifies a real Kitty window, not general protocol conformance. | Removed fabricated values; local launches also discard inherited parent Kitty IDs. | Protocol probes still work. Clients relying solely on the variable may no longer auto-enable decorative graphics, including affected Codex pet implementations. |
| Medium: resize reliability | Resize IPC promises could reject outside the synchronous `try/catch`, and rejected dimensions could suppress a later retry. | Handle rejected promises and invalidate only the failed latest request. | Closed/disconnected races produce a diagnostic; another size synchronization can retry. No blind retries or timing increases. |
| Medium: Windows compatibility | Local Windows panes did not tell xterm that their backend is ConPTY. | Set `windowsPty: { backend: 'conpty' }` for local Windows panes only. | Uses xterm's native viewport-growth behavior without guessing a bundled Windows build or applying local assumptions to SSH. |
| Medium: maintenance | The pinned node-pty npm package already supplies deferred ConPTY startup, PID refresh and process-list guards, but JaneT still carried patch implementations for them. | Remove obsolete mutation code and associated backport machinery after comparing the original npm tarball. | Keep the Electron `app.asar.unpacked` worker-path fix and DLL packaging, which still have a demonstrated purpose. |

The native/upstream-first simplification removes a net **772 lines from `src/`
and `scripts/`**. That is a maintenance reduction, not a measured speedup or proof
that every upstream protocol edge case is fixed.

The user-visible selection contract intentionally changes for mouse-aware TUIs.
Ordinary selection in a shell still works. Applications can implement their own
selection/copy using mouse input and OSC 52; JaneT continues to require a recent
copy gesture or explicit permission before an OSC 52 clipboard write.
Hover and focus reports remain native behavior; only the forced selection gesture
is owned locally. The graphics detection tradeoff is visible in
[Codex's pet protocol selection](https://github.com/openai/codex/blob/main/codex-rs/tui/src/pets/image_protocol.rs).

## What should remain

| Mechanism | Reason |
| --- | --- |
| Output ACK after `term.write` completes, high/low watermarks and generation checks | Prevent unbounded buffered output and stale acknowledgements. This follows [xterm's flow-control guidance](https://xtermjs.org/docs/guides/flowcontrol/). |
| `term.paste`, bracketed paste and `onBinary` | Preserve TUI paste framing and legacy mouse bytes. Writing pasted text straight to the PTY would bypass negotiated paste behavior. |
| Validated OSC 8 / URL bridge | Electron needs an explicit external-browser route. The browser default is not a replacement for this boundary. |
| OSC 52 bounds, consent and validated IPC | Terminal output is untrusted. Removing these checks would weaken the clipboard and process boundary. See [xterm security guidance](https://xtermjs.org/docs/guides/security/). |
| Cached xterm instances and explicit PTY/process cleanup | Pane reshaping and tab switching must not create duplicate processes or lose terminal state. |
| Bundled Windows ConPTY and its packaged DLL payload | Required by the existing Windows transport, including the tested APC graphics path. The package layout must work after Electron rebuild. |
| Unicode 11, FitAddon, SearchAddon and WebLinksAddon | Existing upstream components already supply these behaviors; no replacement abstraction is needed. |
| Image size/storage limits and disabled SIXEL/iTerm image protocols | Keep current tested scope and resource bounds. Enabling another protocol needs its own transport/rendering/lifecycle checks. |

## Configuration and upstream research

| Area | Current finding | Recommendation / status |
| --- | --- | --- |
| Terminal identity | Local PTYs use `TERM=xterm-256color`, `TERM_PROGRAM=JaneT`, `COLORTERM=truecolor`; SSH requests xterm-compatible PTY behavior. | Keep portable identity. Do not claim to be Kitty, iTerm or another terminal to activate unsupported behavior. |
| Windows resize semantics | xterm supports `windowsPty` to account for ConPTY's behavior when the viewport grows. | Implemented `{ backend: 'conpty' }` only for local Windows panes. Do not infer the bundled DLL's build from the host OS, and do not apply local Windows assumptions to SSH. See [xterm options](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/). |
| Synchronized output | xterm 6 includes DEC mode 2026. | Let applications negotiate it; no custom frame buffering. [xterm 6.0 release](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). |
| Enhanced keyboard protocol | Installed xterm exposes `vtExtensions.kittyKeyboard`, default off. Upstream has open layout/modifier gaps and an IME-loss report. | Leave off for now. Before enabling, cover Shift+Enter, Alt/Option, non-US layouts, IME composition and clipboard shortcuts on each OS. [#5882](https://github.com/xtermjs/xterm.js/issues/5882), [#6112](https://github.com/xtermjs/xterm.js/issues/6112). These reports are upstream risks, not reproduced JaneT failures. |
| Codex alternate screen | Codex documents `tui.alternate_screen = "auto"` as the default, plus `--no-alt-screen`. | Keep the default. Use the documented override only when a user prefers native scrollback. Current Codex also documents `/raw` / `tui.raw_output_mode` for copy-friendly output. [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli). No real user configuration was changed. |
| Prerelease packages | xterm 6.1.0-beta.304, image addon 0.10.0-beta.301 and node-pty 1.2.0-beta.14 are pinned. Direct Kitty support remains a prerelease feature. | Keep versions unchanged in this cleanup. A stable-only migration needs a deliberate graphics feature decision and cross-platform validation; blindly downgrading can remove supported behavior. |
| GPU rendering | JaneT currently uses the DOM renderer. | Benchmark the existing performance fixture before adding WebGL; if added, test context loss, fallback, image rendering and many panes. No measured GPU benefit is claimed here. |
| Unicode/graphemes | Unicode 11 widths are enabled; this is not complete modern grapheme/emoji layout support. | Evaluate the upstream grapheme addon only with real CJK, combining-mark and emoji fixtures matched to target TUIs. No hand-written width corrections. |
| Accessibility | Terminal input is labelled, but xterm screen-reader mode is not wired to Electron accessibility state. | Follow-up: use xterm `screenReaderMode` with platform accessibility state or an explicit setting; verify NVDA/VoiceOver. Do not equate an input label with accessible terminal output. |
| Scrollback and macOS Option | xterm defaults remain in use. | Expose bounded scrollback or Option-as-Meta only for a demonstrated user need; avoid global TUI-specific overrides. |

## Verification

Environment: Windows 10.0.26340.0, Node **v22.23.2** (CI major 22), Electron
43.2.0 and Python 3.12.14. Dependencies and lockfile are unchanged. The existing
installed checkout was used; no dependency update or `npm ci` was needed.

| Check | Result |
| --- | --- |
| `node --version` | `v22.23.2` |
| `npm.cmd run typecheck` | Passed, including after the final E2E-only edit. |
| `npm.cmd test` | 85 files passed; **1,267 passed, 8 skipped, 0 failed**. |
| `npm.cmd run build` | Passed. Existing Vite configuration-format and bundle-size warnings remain. |
| Exact desktop smoke command below | **26 passed, 0 skipped, 0 failed**. |
| Forced-selection regression, `--repeat-each=3 --retries=0` | **3 passed** after correcting its measurement boundary; no production workaround added. |
| `npx.cmd playwright test --config playwright.config.ts` | Final full run: **52 passed, 5 skipped, 0 failed** (3.7 minutes). First run: 51 passed, 5 skipped, 1 visual-matrix tab-click timeout; see caveat below. |
| Visual matrix, `--repeat-each=3 --retries=0` | **3 passed** with no code changes after the timeout, followed by the passing normal full-suite run. |
| `git diff --check` | Passed. |

The smoke command exactly matches the Windows/macOS selection in `ci.yml`:

```powershell
npx.cmd playwright test --config playwright.config.ts tests/e2e/dev-instance.spec.ts tests/e2e/close-shutdown.spec.ts tests/e2e/pane-maximize.spec.ts tests/e2e/terminal-copy.spec.ts tests/e2e/terminal-graphics.spec.ts tests/e2e/optional-workspace-setup.spec.ts tests/e2e/editor.spec.ts tests/e2e/settings-recovery.spec.ts tests/e2e/local-terminal-recovery.spec.ts
```

Additional regression/diagnostic commands:

```powershell
npx.cmd playwright test --config playwright.config.ts tests/e2e/terminal-copy.spec.ts --grep 'retains a modifier' --repeat-each=3 --retries=0
npx.cmd playwright test --config playwright.config.ts tests/e2e/final-visual-matrix.spec.ts --repeat-each=3 --retries=0
```

Checks used isolated test profiles, with `ELECTRON_RUN_AS_NODE` and
`ELECTRON_NO_ATTACH_CONSOLE` removed. Node 22 and portable Git 2.55.0.windows.5
were placed first on the test process PATH. `JANET_TEST_PYTHON` pointed to the
verified `C:/Users/pckpr/AppData/Roaming/uv/python/cpython-3.12.14-windows-x86_64-none/python.exe`.
Sandbox attempts hit filesystem/native-tool limitations; authorized checks ran
outside that sandbox. Baseline unit/component validation was 1,268 passed with
8 skips. The final count reflects removed obsolete workaround tests and added
native-behavior regressions, not newly skipped coverage.

The first selection E2E assertion incorrectly included pre-drag hover/focus
reports. The trace and installed xterm source identified those bytes; capture
now starts after positioning/focusing and asserts no reports during the actual
modifier-down/mouse-down/drag/up gesture. It failed 3/3 before that test correction
and passed 3/3 afterward with retries disabled.

The five full-suite skips are the opt-in installed-Hermes test, public screenshot
replacement, a POSIX-only path-drag test, and two packaged-runtime tests. The
eight unit skips are existing platform/tool-conditional cases; none were added.

The first full run timed out at `final-visual-matrix.spec.ts:284`, switching back
to Active workspace after another shell exited. The locator was found and passed
visibility/stability checks, then the click did not complete. This was not a
terminal-copy assertion failure. Three focused repetitions passed without retries
or code changes, as did the subsequent full suite; the cause remains unproven,
so this review does not claim to fix it. If it recurs, capture renderer
responsiveness and browser stderr at that click and compare the baseline under
the same workload before changing terminal or test behavior. Original evidence is retained locally in
`test-results/review/visual-matrix-initial-trace.zip` and
`test-results/review/visual-matrix-initial-error.md`.
Final run logs are `test-results/xterm-unit.log`,
`test-results/xterm-smoke-final.log` and `test-results/xterm-e2e-final.log`.

No dependencies, user profiles, real agent configuration, commits, PRs or releases
were changed by this review. macOS/Linux desktop behavior and a live installed
Codex session require their own validation.
