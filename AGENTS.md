# Working in JaneT

Read `CONTRIBUTING.md` and `.github/workflows/ci.yml` before changing or validating code. The workflow is the source of truth for the current runtime, platforms, and test selection.

## Keep product documentation current

- For every user-facing feature, workflow, setting, or supported-platform change, update the matching VitePress guide in `docs/` in the same change. Keep the README as a short project landing page that links to the published guide at https://sjormz.github.io/JaneT/.
- Write for app users: use the current UI labels, explain prerequisites and steps, and state meaningful behavior limits. Update VitePress navigation when adding or moving pages.
- Include a relevant screenshot for each documented screen or workflow. Capture synthetic, non-sensitive data; never publish real user files, terminal output, credentials, private URLs, or personal information. Give each image useful alt text and a caption, and refresh it when the UI changes.
- On Windows, rebuild the app and run `$env:JANET_UPDATE_PUBLIC_SCREENSHOTS='1'; npx.cmd playwright test --config playwright.config.ts tests/e2e/public-screenshots.spec.ts` to refresh the public screenshot set in both `assets/screenshots/` and `docs/site/public/screenshots/`. Keep every screenshot in the app's One Dark theme and review every changed image before publishing it.
- Run `npm run docs:check` after documentation changes and inspect the changed pages and screenshots. Keep this command aligned with the site's build and link checks. For visual or navigation changes, review the site locally at desktop and narrow widths.
- If a change does not affect user documentation, record the reason in the PR or completion report. Documentation checks do not establish that the guide matches current product behavior; review affected workflows against the app.

## Shipping requests

For "let's ship this", "get this out to prod", or a JaneT release request, read
`.agents/skills/ship-janet/SKILL.md` and follow the existing PR-to-tag release flow.
Preparation, review, dry-run, or skill-authoring requests do not authorize
publishing. Never bypass required reviews or rewrite published tags/assets.

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
