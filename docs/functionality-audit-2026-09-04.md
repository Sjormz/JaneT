# JaneT functionality and code audit

Date: 2026-09-04. Scope: current working tree, including the uncommitted UI changes. This is an audit and proposed plan, not an implementation or release certification.

## Overall assessment

JaneT has a substantial functional foundation: terminal interaction, local editing, SSH, workspace lifecycle, and settings recovery already have dedicated implementations and tests. A rewrite is not justified. The next investment should be reliability and repeatable verification, followed by consolidating the recent UI changes. New features should wait until this baseline is dependable.

## Verification performed

| Check | Current result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed outside the sandbox; the first attempt was blocked by esbuild filesystem permissions |
| `npm test` | 66 files passed, 3 failed; 1,171 tests passed, 3 failed, 4 skipped |
| Isolated `tests/unit/textFileIO.test.ts` rerun | 9 passed, 1 skipped |
| Electron `editor.spec.ts` | Passed: local Monaco editing/saving under the packaged app origin |
| Electron `terminal-copy.spec.ts` | Both passed: ordinary copy and alternate-screen mouse-tracking TUI copy |
| Windows `spawn('npx.cmd', ['--version'], {shell:false})` | Reproduced `EINVAL` |

Full-suite failures:

- `buildShellInit.test.ts`: Windows PowerShell 5.1 stopped at a PSReadLine publisher-trust prompt. This run did not establish a shell integration defect; the test environment was interactive when it needed to be deterministic.
- `hermesAgentPlugin.test.ts:202`: the hard-coded Windows `python` subprocess returned a null status. Capture the spawn error and establish a usable Python interpreter before treating this as plugin behavior failure.
- `textFileIO.test.ts:262`: the first concurrent save returned `PERMISSION_DENIED` rather than success. The entire file passed immediately in isolation. This is an unresolved intermittent failure, not proven data loss or a confirmed serialization bug.

The full Electron suite, real remote SSH/jump hosts, release installation/update, macOS/Linux behavior, screen readers, and performance under sustained load were not exercised in this audit. No CVE or penetration audit was performed. Passing sampled contrast checks is not whole-app AAA certification.

## Prioritized findings

### 1. High: settings changes can appear saved when persistence failed

Evidence: `src/renderer/App.tsx:748` onward updates local state then suppresses `setSettings` rejection for theme, font size, sidebar, snippets, and notifications. Similar paths exist for SSH profiles and workspace presets at approximately lines 1885–1911. `src/main/settings.ts:383` owns persistence, and its failure branch at line 409 rejects the operation. `src/main/index.ts:697` forwards that outcome to the renderer.

Impact: a user can believe a snippet, profile, or preset was saved, only to lose the change after restarting. This is a confirmed error-handling gap from source inspection; disk failure was not injected into the user's live profile.

Plan: reuse the existing settings-error presentation rather than inventing another notification system. Await the save or reconcile optimistic state on failure; preserve the user's draft and offer retry. Route the affected handlers through one small shared persistence path.

Acceptance: mocked disk/IPC failure produces a visible actionable error, no false saved state, and a successful retry survives relaunch. Cover snippets, SSH profiles, presets, and appearance settings.

### 2. High: the normal Windows development launcher is unreliable

Evidence: `scripts/dev.mjs:46`, `:150`, and `:262` select `npx.cmd` on Windows and spawn it without a shell. The same spawn shape reproduced `EINVAL` on this machine.

Impact: the standard local feedback loop fails before useful UI review. Manual alternate launch paths make it easier to review an old built window instead of current source.

Plan: launch the installed Vite Node entrypoint and Electron executable directly, using existing dependencies. Add a small real Windows launch smoke test. Identify dev/build mode and checkout/build identity in diagnostics so an old app window is unmistakable. Avoid unnecessary automatic main-process restarts that terminate working terminals.

Acceptance: `npm run dev` starts from a clean Windows shell; renderer changes appear in the attached window; occupied-port/wrong-checkout cases give clear errors; Ctrl+C leaves no child process tree.

### 3. High-priority investigation: intermittent safe-save failure

Evidence: full-suite failure and isolated success above. `src/main/filesystem.ts:447` implements revision checks, exclusive temporary files, syncing, and atomic rename at line 534. The failing test deliberately gates rename while issuing a second save.

Impact: a genuine Windows file-locking issue could reject valid saves, but the current evidence does not identify whether this is filesystem interference, test isolation, or implementation behavior.

Plan: repeat the existing test under Windows full-suite load and record the original OS error around rename, without logging file contents. Include locked/read-only target cases. Do not replace safe atomic saving with direct truncation or suppress the failure to make the suite green.

Acceptance: reproducible cause and regression check; first writer succeeds when permitted, stale second writer conflicts, failure preserves original bytes and the dirty editor buffer.

### 4. Medium: platform coverage does not match the app's risk profile

Evidence: `.github/workflows/ci.yml` runs the broad unit/component and Electron suites on Ubuntu. Windows/macOS run close-shutdown and one startup-command scenario. Python and shell prerequisites are not consistently established for the local suite. CI does not upload failure artifacts in this workflow, despite Playwright capturing them.

Plan: reuse existing specs for a small Windows/macOS smoke lane: copy, editor save/conflict, recovery, and pane operations. Make interpreter/shell prerequisites explicit with actionable diagnostics. Upload traces/screenshots on failure. Remove the duplicate Linux build: `test:e2e` already builds.

Acceptance: clean-checkout CI can reproduce the supported workflows on all three OSes, prerequisite failures are distinguishable from app regressions, and failed jobs retain useful evidence.

### 5. Medium: visual checks miss the theme being actively refined

Evidence: `tests/e2e/final-visual-matrix.spec.ts:8` tests only Tokyo Night and Solarized Light, while the current reference work changes One Dark. The stylesheet has overlapping terminal/header rules in the base layout, visual-system consolidation, glass refinement, and final rhythm sections (`global.css:2818`, `:3347`, `:4014`, `:4263`). The file is 4,369 lines.

Impact: later overrides can conceal which rule owns borders, focus, backgrounds, and scrolling. Automated checks can pass while the user's selected theme remains broken.

Plan: cover One Dark immediately; check every built-in theme with a lightweight matrix. Consolidate duplicate component rules into their existing sections, keeping the current appearance. Explicitly test xterm's actual scrollbar DOM, no-history/long-history states, nested splits, focus/broadcast states, narrow windows, keyboard navigation, and reduced motion. Use a distinct theme name if the new neutral palette is intended to differ from familiar One Dark.

Acceptance: no double scroll owner, no contrasting empty scrollbar strip, no clipped active outline, visible keyboard focus, and independently spaced panes across tested themes. Do not equate screenshot geometry or eight contrast samples with complete accessibility conformance.

### 6. Medium: application orchestration needs incremental separation

Evidence: `App.tsx` is 2,900 lines and owns settings, tabs/panes, SSH setup/reconnect, terminal cleanup, commands, and overlays. `ssh.ts` is 2,143 lines. Size alone is not a defect, but the repeated persistence handling demonstrates a real maintenance cost.

Plan: extract settings persistence first because it fixes an observed issue. Then separate workspace/session operations only as those workflows change. Preserve the existing `useEditorDocuments` and workspace lifecycle boundaries; do not replace them with a new state framework. Add runtime IPC validation only where a traced handler lacks validation in its manager, not a duplicate validation layer everywhere.

Acceptance: one owner for each modified workflow, fewer duplicate effects/error paths, unchanged behavior proven by existing tests. No broad rewrite or new dependency required.

### 7. Low, measurement first: establish performance budgets

Evidence: production build reports editor API around 2.66 MB minified and a high-contrast chunk around 1.17 MB. `src/renderer/monacoRuntime.ts:24` already dynamically loads Monaco, so recommending basic lazy loading would duplicate existing behavior.

Plan: measure cold start, first editor open, terminal typing latency during sustained output, and memory after repeatedly opening/closing panes. Then trim unused editor language contributions only if measurements justify it. Keep terminal output flow control intact.

Acceptance: recorded repeatable baseline and an agreed regression budget; any optimization demonstrates a measured benefit without degrading terminal responsiveness or editor capabilities.

## Existing safeguards to preserve

- Main-window IPC sender validation and Electron isolation/sandbox settings (`src/main/index.ts:256`, `:443`). These are useful safeguards, not proof every boundary is secure.
- Settings generation backup, flushed temporary writes, and recovery handling (`src/main/settings.ts:343`, `:528`). SSH secrets use Electron safe storage rather than plaintext fallback.
- Local safe-save revision/path checks and temporary-file cleanup; remote save handling already has dedicated logic in the SSH manager.
- Dirty-editor close handshake cancels on timeout or renderer loss (`src/main/workspaceLifecycle.ts`), rather than silently approving shutdown.
- Existing Monaco lazy loading, model disposal, and dedicated editor controller.
- Current ordinary and TUI terminal-copy behavior, verified by Electron tests during this audit.

## Proposed implementation order

| Phase | Deliverable | Exit condition |
| --- | --- | --- |
| 1 — Reliable baseline | Repair Windows launcher; expose settings save failures; investigate intermittent save failure; make test prerequisites explicit | Standard dev command works; persistence errors are visible; save regression explained and covered |
| 2 — Regression protection | Reuse core E2E specs across OSes; retain CI artifacts; add One Dark and scrollbar states | A UI or terminal regression produces a reproducible failure with evidence |
| 3 — UI/code consolidation | Remove conflicting CSS overrides; extract only repeated settings/session orchestration | Current design remains intact, ownership is clearer, tests stay green |
| 4 — Measured refinement | Performance baselines and targeted improvements; remaining remote/release/accessibility checks | Measured improvements and an explicit tested/untested release checklist |

## Approved implementation follow-up

Implemented on 2026-09-04, preserving the existing UI changes and adding no dependencies:

- **Hermes/TUI clipboard:** protected selection survives packet-split mouse-mode changes and cached pane remounts; explicit paste uses the trusted preload/main clipboard bridge and xterm bracketed paste. OSC 52 copies are bounded and validated; recent explicit copy gestures authorize an immediate write, other requests require confirmation, and terminal clipboard reads remain unsupported.
- **Word-labelled links:** OSC 8 clicks use the browser bridge even when a TUI redraws between press and release. Selection drags do not open links; mouse reports are suppressed during link activation to avoid duplicate TUI handling, and outside release/window blur cancels the gesture.
- **Settings:** one queued persistence hook retains newest unsaved values and exposes failure plus retry instead of silently swallowing errors. This is in-memory recovery, not crash-proof draft storage.
- **Development:** launch installed Vite/ Electron executables directly, avoiding Windows command-shim spawning. Refuse unverified server reuse, log checkout/mode, and rebuild main/preload without automatically terminating active terminals. Restart explicitly to load main/preload changes.
- **Regression coverage:** all five built-in themes at two viewports, matching terminal/scroll-track backgrounds and a single scroll owner; simplified overlapping terminal CSS and improved sampled status-text contrast. Windows/macOS CI now runs broad unit tests and core desktop workflows, sets up Python, and retains failure artifacts.
- **Test reliability:** allow an explicit Python executable; isolate inherited PowerShell module paths; align the tmux test timeout with its existing integration deadline.
- **Measurements:** added startup, first-editor-open, sustained-output input response, and five-cycle pane-memory baseline artifacts. Monaco remains lazy-loaded; no speculative dependency or language removal.

### Local verification

Typecheck and production build pass. Full unit/component suite: **71 files, 1,180 passed, four skipped**. Final focused Electron acceptance run: **13 passed**. Coverage includes ordinary/TUI copy, OSC 8 redraw clicks, OSC 52 consent, bracketed paste, dev launcher startup/shutdown, editor save/conflict, settings recovery, local terminal recovery, close protection, all-theme visual checks, and performance sampling. `git diff --check` passes.

One Windows baseline sample: startup to terminal output **1,258 ms**, first editor open **839 ms**, input observed during sustained output **40 ms**. Renderer working set was **134,220 KB before / 157,500 KB after five split-close cycles**. These are automation-observed timings and process-memory samples, not pure keystroke latency, cold-disk medians, or evidence of a leak. Repeat the documented command before choosing regression budgets.

### Remaining validation / deliberately deferred work

- The earlier intermittent concurrent-save `PERMISSION_DENIED` did not reproduce in the current full runs. Existing conflict/revision checks remain intact; no speculative overwrite/rename retry was introduced. Its root cause is still unresolved, not claimed fixed.
- The initial pass only checked Hermes source and protocol reproductions. The follow-up below verifies the actual installed TUI with an isolated profile; provider-backed conversations remain untested.
- Updated macOS/Linux CI, real SSH hosts/authentication/SFTP, packaged installers, signing/updating, and formal accessibility conformance require their respective environments. Passing layout checks and sampled contrast is not a complete AAA audit.
- Further workspace/SSH orchestration extraction remains incremental, tied to changed workflows; the settings extraction fixes the demonstrated duplication without a broad rewrite. Performance optimization waits for repeatable measurements and agreed budgets.
- The user's running app was not restarted. Save work and relaunch the source development instance to pick up the new main/preload bridge. No release, commit, or push was performed.

## Follow-up: actual Hermes ordinary-drag copying

The user clarified that **ordinary drag followed by Ctrl+Shift+C** fails; paste generally works. Reproduced the exact failure in the installed `hermes --tui` running inside an isolated JaneT instance: dragging visible text and copying left the clipboard unchanged. The earlier Shift-drag regression was a different path and did not prove this worked.

Cause: Hermes owns ordinary mouse selection and paints its highlight itself. JaneT previously looked only for xterm's native selection, which is empty in that path; xterm does not emit Ctrl+Shift+C as Ctrl+C. Subsequent TUI redraws also make reading the later screen an unreliable substitute for the originally selected text.

Fix: retain the ordinary mouse-tracked drag text at mouse-up using xterm's public Unicode/wrap-aware selection API, before the mouse-up reaches the PTY. Copy reads that immutable text even after a redraw. Mouse reporting continues normally; there is no copy-mode toggle, frozen output, or injected Ctrl+C. A new left click or typing invalidates the retained selection. Forced Shift/Option-drag and paste remain intact.

Verification: the real installed `hermes --tui` passed **three consecutive runs**, copying the selected banner text before and after a resize-induced redraw. Temporary JaneT/Hermes profiles were used; no user conversations, credentials, or provider prompts were used. Added opt-in `hermes-copy.spec.ts` plus an always-on terminal-copy check for full-screen erase, stale-selection invalidation, and absence of interrupt bytes. Typecheck/build and **74 targeted unit/component tests** pass; the terminal-copy Electron suite has **five passing tests**. This establishes the reproduced gesture, not every possible long-history/streaming conversation scenario.
