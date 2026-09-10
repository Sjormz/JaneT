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
