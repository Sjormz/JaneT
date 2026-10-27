# CI reliability review — 2026-09-10

## Finding

The repeated failures have different immediate causes. Our process makes them expensive: local checks have been narrower than the documented pre-PR checks, timing-sensitive native tests reach CI without sufficient failure-path verification, and some failures hide the diagnostic needed to identify the underlying exception. A green rerun can leave those weaknesses intact.

For PR #136, local validation covered 177 unit/component tests and one Library E2E flow on Windows with Node 24.19.0. CI uses Node 22, runs 1,275 unit/component cases (including platform skips), runs the full E2E suite on Linux, and a separate desktop selection on Windows/macOS. `CONTRIBUTING.md` already required full validation; the agent did not follow it. No root `AGENTS.md` existed to reinforce the requirements in the agent workflow.

## PR #136: what actually failed

Head: `1f7a1229fb6bb7934802e326a7f9c2e3ee98c779`.

| Job | Evidence | Conclusion |
| --- | --- | --- |
| [Verify / Linux](https://github.com/Sjormz/JaneT/actions/runs/34454196801/job/102796645729) | Passed unit/component tests, build, and full Electron suite. | This run does not show a Linux regression. |
| [Windows desktop](https://github.com/Sjormz/JaneT/actions/runs/34454196801/job/102796645798) | Unit test `agentCliLaunch.test.ts:40`: one of 12 concurrent setup helpers emitted “Automatic setup could not safely update this configuration.” 1 failed, 1,266 passed, 8 skipped. The job never reached desktop smoke execution. | A setup exception occurred. The catch in `agent-cli.ts` hides its error/code; the log does not establish whether it was a file-lock, replacement, cleanup, or other exception. It is not the separate “already running” lock-deadline message. |
| [macOS desktop](https://github.com/Sjormz/JaneT/actions/runs/34454196801/job/102796645560) | Optional setup timed out in `firstWindow()` after 10 seconds. The clipboard trace stopped at `terminal-copy.spec.ts:273`, also waiting for the first window, before any clipboard operations. Both passed on retry. A 30-second worker teardown timeout remained, causing job failure despite 24 passed and 2 flaky tests. | Startup intermittency plus unsuccessful cleanup, not a demonstrated clipboard assertion failure. The trace does not identify why Electron failed to produce a usable first window. |

The Windows setup implementation/test and both macOS failing specs are unchanged between the PR and its `origin/main` base. That supports investigating existing reliability problems rather than assuming the new Library folder behavior caused them. It does not prove that every timing interaction is unrelated to the PR.

The clipboard cleanup helper awaits `app.evaluate(app.exit)` before registering its bounded close wait. An unresponsive Electron connection can therefore prevent cleanup from reaching that timeout. The pane E2E harness already has a regression for stale CDP cleanup; that protection has not been applied consistently across the suite. Fixing cleanup alone would not explain or fix the missing first window.

## Recent history

- [PR #134 failure](https://github.com/Sjormz/JaneT/actions/runs/34277990165): Windows Hermes integration called PATH `python` and hit `spawnSync python ETIMEDOUT`. The subsequent fix passed setup-python's exact executable through `JANET_TEST_PYTHON`; the current workflow retains it.
- [PR #135 initial failure](https://github.com/Sjormz/JaneT/actions/runs/34363644488): a component test expected three terminal-creation calls before asynchronous creation had completed. Later commits added readiness waits.
- [PR #135 later failure](https://github.com/Sjormz/JaneT/actions/runs/34368824495): Windows clipboard paste bytes lacked the expected bracketed framing. Commit `6a87444` waited for an xterm marker after the mode sequence instead of assuming IPC delivery meant parsing was complete.
- [PR #135 final run](https://github.com/Sjormz/JaneT/actions/runs/34369815980) and [merged main](https://github.com/Sjormz/JaneT/actions/runs/34370733012) passed. Subsequent failures demonstrate why a passing run does not establish that all native timing issues are resolved.

This is not literally every PR failing, nor evidence that GitHub changes the code. Environment assumptions, asynchronous readiness, incomplete cleanup, and incomplete local coverage are recurring contributors. Node-major mismatch is a verification gap; the logs do not prove it caused these particular failures.

## Investigation limits and next repairs

A temporary diagnostic helper invoked the real `installCodexActivity` function for 20 batches of 12 concurrent processes against disposable configurations on local Windows/Node 24.19.0. All 240 calls passed. This was narrower than CI's full-suite load and did not reproduce the Windows error; no specific filesystem exception is claimed as established.

The macOS failure artifact was inspected directly. This Windows machine cannot validate a macOS startup fix. Needed next: capture Electron child stderr/exit and startup state on the failing macOS launch; capture a safe error code/stage for the concurrent setup exception. Then fix the demonstrated causes and verify the current PR head across all CI jobs. Do not merely increase retries or suppress warnings.

`AGENTS.md` now makes the existing validation requirements explicit and adds readiness, failure-path cleanup, diagnostic, and current-head verification rules. This review and those rules do **not** fix the outstanding CI failures.

## Repairs and verification

- Replaced duplicated Electron teardown with a shared helper that observes process exit before requesting it, bounds the debugger wait, and kills only the test-owned process/tree if needed. A regression test leaves the debugger request permanently unresolved and verifies cleanup still completes without leaked listeners or timers. This fixes the demonstrated unbounded cleanup path; it does not claim to fix the unexplained macOS launch intermittency.
- Added opt-in, sanitized setup error-code/syscall diagnostics and included them in the concurrent launch assertion. All 12 callers still run simultaneously and must succeed. A negative runtime check verifies the diagnostic contains the expected filesystem code without paths or private configuration contents. Desktop CI now records Playwright browser launch diagnostics.
- Passed setup-python's exact executable to E2E steps as well as unit tests. A local full-suite run exposed the same PATH assumption in the Hermes E2E fixture.
- Shortened the Windows failing-command fixture in the visual matrix so its command-start marker survives wrapping in the smallest pane, matching the existing POSIX fixture precaution. The visible failure-decoration assertion remains intact.

Windows validation used Node 22.23.2 and Python 3.12.14. Another 20 batches of 12 concurrent setup helpers passed (240 calls) on Node 22; the original Windows exception remains unreproduced. The full unit/component suite passed with four workers: 85 files, 1,268 passed and eight skipped. An earlier unrestricted local run timed out in release-tooling validation under heavy parallel load; reducing local worker count is a resource constraint, not a claimed fix for CI. Typecheck and production build passed. The setup diagnostics and stalled-debugger regression also passed after the final assertion changes (five tests).

The first full Electron run had 49 passes, five skips, and three failures: the narrow-pane fixture, a Source Control hover tooltip, and Hermes without an explicit Python path. After the fixture/environment corrections, each affected case passed twice with retries disabled. A second full run passed 51 cases with five skips but reproduced the hover failure. Six focused repetitions then failed three times. Temporary DOM/event diagnostics established that the first shell cwd report replaced the hovered Source Control with its repository-search state, destroying the tooltip timer. The test now waits for shell readiness before Source Control interactions; all tooltip assertions remain.

With the shell-readiness wait, the Source Control case passed six consecutive runs with retries disabled. A final full local Electron run and current-head hosted checks are required before declaring validation complete.

## Follow-up on repair commit `fc1b005`

[CI run 34461910559](https://github.com/Sjormz/JaneT/actions/runs/34461910559) passed Linux and macOS. Windows passed its unit suite but failed `runs ordered workspace startup commands once per fresh terminal`: the injected "Failure gate" fixture was missing after reload, and the artifact showed the previous "Ordered startup second" session instead. The retry similarly lost "Ordered startup". The shared fixture helper wrote settings while the current renderer still had a debounced session autosave scheduled. It now pauses renderer timers during the seed/reload boundary and resumes them immediately afterward. Three focused repetitions passed with retries disabled; all shared callers remain in the full E2E validation.

The local visual matrix also reproduced its missing visible marker after the initial shortening. Its captured terminal showed PSReadLine redraws filling the small pane and scrolling the command start offscreen. The fixture now emits its unique output marker with a short shell function, waits for that output, then executes the native failing command separately. This retains actual nonzero exit semantics and the visible-decoration assertion.

The repair commit was pushed before local full-suite verification completed. That was a process mistake: the next update must finish local verification before pushing, then check the new hosted results. A running or partially passing suite must never be reported as a clean run.

Final local verification for this follow-up: Windows, Node 22.23.2, Python 3.12.14; typecheck and production build passed; full unit/component suite (`npm test -- --maxWorkers=4`) passed 1,268 tests with eight skips; full Electron suite (`npx playwright test --config playwright.config.ts --retries=0`) passed 52 tests with five skips. The visual matrix passed three focused repetitions and the startup-command case passed three focused repetitions, all with retries disabled. Hosted checks must still be verified on the new commit.

[Run 34469106549](https://github.com/Sjormz/JaneT/actions/runs/34469106549) passed all platforms on `b1101ed`, but Windows reported one clipboard retry. This was an assertion failure, unlike the original macOS startup timeout: the synthetic `BRACKETED_TEXT_READY` marker became `^CACKETED_TEXT_READY` when the test's real Ctrl+C interrupt produced delayed shell output. The test already intercepted paste input at the main IPC boundary; that interception now starts before Ctrl+C, isolating the injected TUI stream from a real shell redraw while retaining the clipboard and exact-byte assertions. Six focused repetitions passed without retries.
The full Windows desktop selection from ci.yml then passed all 26 tests with retries disabled; typecheck passed again. The prior full unit/build/Electron results remain applicable to unchanged app code and the other specs.

Run 34470136665 passed both desktop jobs but exposed an intermittent Linux component failure in `disambiguates duplicate pane labels without exposing terminal IDs`: its live-region text stayed empty. This label-formatting fixture sent attention immediately after mount, unlike the neighboring announcement test that first establishes an agent session. It now sends `session.start` and waits for the restored tab's Ready state before requesting attention. The exact label and terminal-ID privacy checks remain. This addresses the fixture's initialization gap; the log alone does not prove the precise React scheduling sequence behind the missed announcement.
Validation for the announcement fixture: all 129 tests in SplitPane.test.tsx passed, the exact case passed three isolated runs, and the full unit suite passed 1,268 tests with eight skips. App code, build inputs, and E2E code are unchanged from the preceding verified runs.

## Dependency and fixture follow-up — 2026-10-26

PR #196 (`208dc698`) failed the same two release-tooling assertions on all three
platforms after updating `node-pty` to beta.18. Tests and the Windows package
verifier independently required beta.15, and the release guide repeated that
version. The project manifest is now the version source for installed and
packaged modules. Tests retain the upstream ConPTY source checks, worker rewrite,
DLL payload checks and wrong-version rejection; packaged verification still
requires a real terminal round trip. Native runtime/build-tool updates remain
enabled in Dependabot but are excluded from the routine dependency groups.

A clean `npm ci` also leaves current Electron packages to download their binary
on first use. CI and release verification now install it explicitly before test
workers start, keeping network installation out of unit-test timeouts. Unit and
Electron JUnit reports are retained alongside failure traces. Playwright retries
remain diagnostic, but a flaky result fails CI.

The inline Start terminals component case now finishes settings/effect setup,
asserts that its keyboard event was handled, and drives its deferred focus frame
explicitly. Holding that frame reproduced the missing-focus assertion; the
original hosted timing sequence remains unproven on this Windows machine.

Full Windows E2E also exposed a visual-matrix race, reproduced once in three
focused repetitions with retries disabled. Its visible failure decoration could
belong to a previous command. Measurement then sampled a temporary busy badge on
the selected tab, rather than the fixture's resting state. Each invocation now
has a unique command comment; the test waits for its saved exit code and zero
busy terminals before measuring. The 7:1 contrast, visible failure decoration
and geometry assertions remain unchanged. Per-state reports attach before
assertions so a failure preserves the measurements that explain it.

A subsequent full run recorded `would-show` where the native notification test
expected `focused`. The test now observes the real main-window focus state after
each focus/blur request before relying on it. Three focused repetitions passed.
That run also recorded a broadcast-confirmation click whose target was moving,
then intercepted by the terminal. Three repetitions in normal preceding-test
order did not reproduce it. The fixture now waits for the dialog's entrance
animation to finish before the real pointer click; the exact original sequence
remains unproven, so this is a readiness guard rather than a claimed root cause.

Hosted repair commit `603bfa9` passed Linux, and Windows passed native packaging
and the packaged PTY check. macOS reported two flaky cases: the dev launcher
remained at "Restoring your workspace" after five seconds, and the TUI-copy case
timed out in `firstWindow()` before any clipboard operation. Their retries
passed; the job correctly failed. No macOS startup root cause is claimed.
CI now retains opt-in startup stages (entry/lock, ready, window/load/show and
settings IPC) by process ID. The dev test keeps Electron/Vite logs in its
disposable profile, attaches them, and observes launcher exit before profile
removal. Its POSIX launcher owns a separate process group for bounded fallback
cleanup; Windows stops only the test-owned process tree. These changes preserve
evidence and fix cleanup; they do not by themselves prove the startup issue fixed.

Commit `c8419c4` again passed Linux and Windows, including native packaging. Its
macOS startup artifact identified a process that acquired its instance lock but
waited 30,812 ms before `whenReady` ran. Readiness advanced when teardown sent a
main-process debugger request, after the first-window deadline; no clipboard
assertion had run. Playwright's Electron loader defers app readiness through its
debugger protocol. All native first-window callers now send an explicit main
readiness handshake alongside their existing window wait. The window's original
deadline still wins if that request stalls, and a regression test covers both
window success and timeout with an unresponsive request. This addresses the
observed idle startup sequence; Electron's underlying macOS cause remains a
hypothesis until platform validation confirms the behavior.

## Remaining startup failure on PR #203

The first #203 head (`1ad590b`) changed only two undici lockfile entries. Linux
passed, but macOS again timed out in the modifier-selection TUI test and passed
on retry. Its trace contains only a successful Electron launch followed by an
unfinished first-window wait and the asynchronous readiness evaluation. PID
11995 held the instance lock, then took 29,830 ms from entry to readiness. No
clipboard assertion ran. This disproves the earlier handshake as a complete fix.

The shared helper now evaluates the synchronous `app.isReady()` query rather
than awaiting `app.whenReady()` through the inspector. The window event remains
the success condition, with its original deadline; a false readiness query does
not count as a ready window. The unit check rejects promise-returning readiness
callbacks and retains stalled-request success/timeout coverage. This tests the
protocol boundary, not Electron's underlying macOS implementation. macOS CI now
repeats the actual failing TUI case 25 times with retries disabled, then runs the
normal desktop smoke selection. A single failed repetition fails the job.

## PR #204 full desktop investigation — 2026-10-27

At `e50ae3569b3619923d7a61426d6709789cd0839b`, automatic checks passed,
but [full desktop run 40373576789](https://github.com/Sjormz/JaneT/actions/runs/40373576789)
failed. Windows had 53 passes, nine skips and two motion/input failures:
PowerShell received `ode` where the test typed `node`. Intel macOS had
17 passes, nine skips and 38 timeouts, beginning before workspace setup's
Electron launch completed. Later processes recorded entry without readiness.
These are not evidence of 38 independent UI regressions. The underlying
startup stall remains unresolved; the earlier Intel qualification also used
a different first-window helper and does not verify this exact head.

Hosted diagnostics established additional, separate problems:

- [Run 40487544104](https://github.com/Sjormz/JaneT/actions/runs/40487544104)
  reproduced a TUI-copy test race in one of 25 macOS repetitions. Moving to
  the selection's start emits a valid SGR hover report (`CSI <35;1;6M`).
  The main-process capture could be cleared before that renderer IPC arrived.
  The test now observes delivery before resetting capture, and waits for a
  distinct rendered marker after enabling synthetic TUI modes. Its no-input
  assertions for the subsequent modifier drag remain unchanged.
- [Run 40489039188](https://github.com/Sjormz/JaneT/actions/runs/40489039188)
  captured four macOS crash reports with `pty.node`'s
  `Napi::ThreadSafeFunction::CallJS` throwing during `node::Environment::RunCleanup`.
  Immediate `app.exit()` bypasses normal application shutdown. A controlled
  [graceful-shutdown comparison](https://github.com/Sjormz/JaneT/actions/runs/40490190988)
  passed 20 motion cases with clean native-exit assertions. The shared cleanup
  helper now requests `app.quit()` while retaining the original bounded,
  test-owned kill fallback. This does not prove the startup stall is fixed.
- That diagnostic also passed 50 Windows motion cases without retries and
  passed macOS startup in the full suite. Neither original intermittent
  failure reproduced. Instrumentation captured DOM keyboard/focus events and
  main-process PTY writes; a passing repetition is not a fix for character loss.
- The macOS visual matrix measured a Gruvbox finished badge at 6.4318:1
  (`#ebdbb2` on `#504945`) at 800x600, below its existing 7:1 assertion.
  This remains an actionable contrast failure; the threshold was not lowered.
- Windows visual cases reproduced profile-removal `EPERM` after a preceding
  click timeout. The finally block hid that original timeout. It now preserves
  the original failure and reports cleanup separately. Graceful shutdown alone
  did not eliminate the deletion failure. A signed Microsoft Handle probe in
  [run 40490823591](https://github.com/Sjormz/JaneT/actions/runs/40490823591)
  found no matching handles at its observation time, so no particular process
  or antivirus is established as the lock owner.

All these runs used hosted Node 24.19.0 and npm 11.17.0. Diagnostic runs changed
only disposable workflow instrumentation and stated fixture behavior; they do
not replace full verification of the eventual PR head. No app setting, screen,
or public-guide procedure changed in these test repairs, so public screenshots
do not need refreshing. The unresolved failures still block merging.
