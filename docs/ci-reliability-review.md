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
