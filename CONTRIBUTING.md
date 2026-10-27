# Contributing to JaneT

Thanks for helping improve JaneT.

## Before you start

- Fork the repo if you are contributing from outside the project.
- Create a branch from `main`.
- Keep changes focused and small where possible.
- Make sure you can run the app locally before opening a PR.

## Local setup

Use Node.js **24.19.0**, pinned in `.nvmrc` and every GitHub workflow to match the current development machine. With nvm installed, run `nvm install 24.19.0` and `nvm use 24.19.0`, then check `node --version`. The package still supports Node 22.22.2+, 24.15.0+, or 26+; these jsdom compatibility floors are separate from the exact development and CI baseline.

Use npm **11.17.0**, pinned in `package.json` to match the current development machine. Dependabot reads `packageManager`, every dependency-installing workflow installs that version explicitly, and `.npmrc` rejects other npm versions before they can change the lockfile. Node's bundled npm can differ even when the Node version is supported. Update the repository pin deliberately when upgrading the development machine's npm; GitHub does not follow machine updates automatically.

```bash
npm install --global npm@11.17.0
npm --version
npm ci
npx --no install-electron
npm run dev
```

On Windows, use `npm.cmd` if PowerShell blocks the npm script shim. If changing the global npm installation is unsuitable, run `npx --yes npm@11.17.0 ci` and `npx --yes npm@11.17.0 run dev` instead. Use the same prefix for other npm commands.

When updating Node, update `.nvmrc` and every workflow's Node selection together. The tooling test checks their alignment. When updating the npm pin, update both `packageManager` and `engines.npm` together, regenerate the lockfile with that version, and verify a clean `npm ci`. Do not hand-edit dependency entries or replace CI's `npm ci` with `npm install` to hide an inconsistent lockfile. Existing Dependabot PRs generated with another npm version need their lockfiles regenerated after this pin lands.

Renderer edits hot-reload. Main/preload edits rebuild, but do not restart Electron automatically: close the dev window and rerun `npm run dev` when your terminals and editors are safe to close. The launcher prints the checkout and renderer URL, and refuses to reuse an already-running server. Set `JANET_DEV_SERVER_URL` to another local port if needed.

The Hermes integration test needs Python 3. If it is not on PATH, set `JANET_TEST_PYTHON` to the Python executable (an absolute path is supported). CI provisions Python explicitly. PowerShell tests use the system module path rather than inheriting another application's PSReadLine.

Install the Electron binary explicitly after `npm ci`, before running tests. Current Electron packages otherwise download it on first use, which can turn a unit test into a network operation. CI and release verification install it before starting test workers.

Dependabot opens `node-pty`, Electron, electron-builder and Playwright updates separately from routine dependency groups. Review their native runtime, test-launcher and package compatibility individually. Keep `node-pty` pinned to an exact version and validate its upstream fixes and packaged terminal before accepting an update.

The `node-gyp` override selects 13.1.0 for native rebuilds. Its Node requirement matches the project, and it replaces the older HTTP client that could crash while downloading Electron headers under backpressure. Keep the native Windows package/PTY check when changing this build-tool override.

To check the actual installed `hermes --tui` copy gesture on Windows, build JaneT, set `JANET_TEST_HERMES=1` in the test process environment, and run `npx playwright test tests/e2e/hermes-copy.spec.ts --repeat-each=3`. Hermes must already be installed and on PATH. This opt-in check uses temporary JaneT/Hermes profiles, no conversation prompts, and tests Shift-drag then Ctrl+Shift+C after a resize redraw. On macOS the native gesture is Option-drag. The regular terminal-copy suite also covers redraw retention without requiring Hermes.

## Validation

Prefer GitHub-hosted verification for pull requests. Push the candidate branch and open or update its PR to run CI. Do not run the full unit/build/desktop suites on your local machine by default. Local checks remain useful for focused iteration or machine-specific diagnosis. Full CI must pass on the current PR head before merge.

To run verification on a pushed branch without opening a PR:

1. Open [Actions → CI](https://github.com/Sjormz/JaneT/actions/workflows/ci.yml).
2. Select **Run workflow**, then choose the branch in **Use workflow from**.
3. Leave **Run the full Electron suite on macOS and Windows (Linux always runs it)** enabled for full desktop coverage. Disable it to use the normal CI desktop smoke selection.
4. Keep **macOS runner** set to `macos-26-intel` for the validated default, or select `macos-26` for Apple Silicon diagnostics.
5. Select **Run workflow** and inspect the run's commit SHA, all jobs and test-result artifacts. A run for an older commit does not verify later pushes.

From the CLI, replace `my-branch` with the pushed branch name:

```bash
gh workflow run ci.yml --repo Sjormz/JaneT --ref my-branch -f full_desktop_e2e=true
gh run list --repo Sjormz/JaneT --workflow ci.yml --branch my-branch --event workflow_dispatch --limit 5
```

Default macOS verification uses the explicit Intel image. Earlier hosted macOS 26 ARM runs reproduced native startup stalls before Electron's first window. Repair head `13b6f3c` subsequently passed the complete suite and 25 TUI repetitions on both Intel and ARM; the test-audit candidate also passed 20 motion repetitions and 30 pane/path cases on each architecture without retries. These passes do not establish the underlying cause of the older startup stalls. An Intel pass is not Apple Silicon verification: add `-f macos_runner=macos-26` to dispatch that architecture separately. The protected `Durable workspace (macos-latest)` check name stays unchanged; job setup logs identify the actual image and architecture. See the [test suite review](docs/test-suite-review.md) for coverage and verification evidence.

Manual runs use the same pinned runtimes, lockfile install, unit tests, build, macOS startup repetitions and Windows package/PTY verification as CI. Their concurrency group is separate, so triggering one does not cancel automatic PR or main verification. The workflow file must exist on the default branch, and the selected branch must contain the dispatch-enabled version. The **Run workflow** button appears once the default-branch version includes that trigger; the CLI can dispatch the updated branch before then. Update older branches from `main` before dispatching them. See [GitHub's manual workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Windows CI also runs the two packaged diagnostics/updater UI cases against the freshly built `release/win-unpacked/JaneT.exe`, after native package/PTY verification. Their traces and `test-results/packaged-ui.xml` are kept separately so they do not overwrite the desktop suite's evidence. Other packaged platforms still need an explicit `JANET_PACKAGED_EXECUTABLE` run.

Only committed and pushed files are tested on GitHub. Local edits and installed-app/device behavior need local inspection. When local verification is appropriate, use:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

CI retains unit and Electron JUnit reports under `test-results/`, alongside failure traces. An Electron test that only passes on retry fails CI; the retry remains available for diagnosis. Inspect the first failure and fix its cause before rerunning the job.
`electron-events.jsonl` records opt-in startup stages by process ID, including window creation/load/show and settings IPC. Dev-launcher Electron/Vite logs come from its disposable test profile and are attached before cleanup. Use these to distinguish an absent first window from a later UI assertion failure.
Use `firstWindow` from `tests/e2e/electronLifecycle.ts` for native Electron tests. It sends a synchronous readiness query alongside the existing window deadline, allowing the inspector request to return while native startup is pending. Do not await `app.whenReady()` inside that startup evaluation. Use the same module's bounded cleanup when the debugger may be unresponsive. macOS CI repeats the TUI redraw/copy case 25 times without retries before running the normal desktop smoke selection; every repetition must pass.

If you change Electron main-process code, preload code, or release behavior, make sure the build still succeeds after your changes.

To record local performance baselines after building, run `npx playwright test tests/e2e/performance-baseline.spec.ts tests/e2e/editor.spec.ts --repeat-each=3`. Attachments record launch/editor timings, terminal input during sustained output, and working-set memory across five pane open/close cycles. Compare medians on the same machine; these are measurements, not a cross-machine performance guarantee. All-theme checks live in `tests/e2e/final-visual-matrix.spec.ts`.

## Pull request expectations

Please include:

- a short summary of what changed
- why the change is needed
- screenshots or screen recordings for UI changes
- any manual testing notes that are relevant
- references to issues when applicable

## Versioning and releases

- `package.json` is the source of truth for the app version.
- Version bumps should be made with `npm version patch|minor|major --no-git-tag-version` in a release PR.
- Releases are tag-driven (`vX.Y.Z`) and published from GitHub Actions.
- Release tags must be created from the merged `main` commit after the release PR lands.
- Do not change version numbers directly in release CI.
- See [docs/release.md](docs/release.md) for the full release checklist.

## Style

- Match the existing TypeScript and React style in the repo.
- Prefer small, targeted changes over broad refactors.
- Keep UI updates consistent with the current design system.

## Reporting bugs

If you find a bug, please describe:

- what you expected
- what actually happened
- the OS and app version
- steps to reproduce

## Security issues

Do not open a public issue for security-sensitive reports. Use GitHub's private security advisory flow instead.
