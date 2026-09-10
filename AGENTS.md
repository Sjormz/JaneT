# Working in JaneT

Read `CONTRIBUTING.md` and `.github/workflows/ci.yml` before changing or validating code. The workflow is the source of truth for the current runtime, platforms, and test selection.

## Before opening or updating a PR

- Use the CI Node major (currently 22), and record `node --version`. A pass on another supported major is useful evidence, not CI parity.
- Use the lockfile. If dependencies changed or the checkout is fresh, run `npm ci`; do not silently update dependencies while debugging.
- Run `npm run typecheck`, the **entire** `npm test` suite, and `npm run build`. Focused tests are for iteration, not a replacement for these checks.
- For documentation-only changes with no runtime, configuration, dependency, or test changes, check the documentation and diff instead; state why runtime tests were not rerun.
- After building, run the desktop smoke command from `ci.yml` on the available desktop OS, plus affected E2E specs not included in that command. Shared app, terminal, persistence, or lifecycle changes need the full `npx playwright test --config playwright.config.ts` run. Linux CI runs it under `xvfb-run --auto-servernum`.
- Set `JANET_TEST_PYTHON` to a verified Python executable for Hermes tests. On Windows use `npm.cmd`/`npx.cmd` if PowerShell blocks their script shims. If sandbox restrictions prevent a build or native test, use the authorized escalation path and report any checks still blocked.
- State the exact commands, OS/runtime, pass/fail/skip counts, and untested platforms. Do not describe a selected test run as full verification.
- When authorized to push, inspect checks on the **current PR head SHA**. PR creation, local success, and an earlier green commit do not prove the new head is green. Report pending or failed checks explicitly.

## Native and asynchronous tests

- A rendered pane does not prove its PTY exists. IPC delivery does not prove xterm parsed output. Wait for the observable state needed by the next action: terminal creation, parsed marker, saved settings, or process exit.
- Preserve assertions about real behavior. Do not fix races with arbitrary sleeps, larger global timeouts, blind retries, skipped tests, or weaker assertions.
- For an intermittent failure, repeat the focused case with retries disabled, then run its normal suite. A passing retry is evidence of a flake, not evidence of a fix. Windows success cannot establish macOS behavior.
- Use an isolated `JANET_E2E_USER_DATA_DIR` and canonical temporary paths (`fs.realpathSync`) for Electron tests. Remove inherited `ELECTRON_RUN_AS_NODE` and `ELECTRON_NO_ATTACH_CONSOLE`. Do not use the user's installed profile or real CLI configuration.
- Teardown must work when Electron/CDP is unresponsive: register exit observation before requesting exit, bound the graceful wait, then stop only the test-owned process/tree and await exit before deleting its profile. Never rely on an unbounded `app.evaluate()` to reach the cleanup timeout; never kill all Electron processes.
- Keep the original failure visible when cleanup also fails. Collect child stdout/stderr, exit information, and Playwright traces for startup failures. A timeout in `firstWindow()` is not a clipboard or UI assertion failure.
- Concurrency tests must retain simultaneous callers and verify every result and saved configuration. Investigate swallowed setup errors with a disposable diagnostic helper or safe error-code diagnostics; do not serialize the test or accept warnings to make it green.

## CI failure investigation

1. Read the failed job/step, assertion, and trace for the exact SHA before editing.
2. Compare the failing code and recent `main`/PR runs. Distinguish a new regression, an existing intermittent failure, an environment problem, and a teardown error; do not infer causation from the job name.
3. Reproduce under the relevant runtime/platform and workload where available. If reproduction fails, document that limit and the next diagnostic needed rather than inventing a root cause.
4. Fix and check the shared cause and its callers. A successful rerun alone is not a regression check.

See `docs/ci-reliability-review.md` for the PR #134–#136 evidence behind these rules.
