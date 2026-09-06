# Contributing to JaneT

Thanks for helping improve JaneT.

## Before you start

- Fork the repo if you are contributing from outside the project.
- Create a branch from `main`.
- Keep changes focused and small where possible.
- Make sure you can run the app locally before opening a PR.

## Local setup

Use Node.js 22.12 or newer. This matches Electron 43 and the release/CI runtime.

```bash
npm install
npm run dev
```

Renderer edits hot-reload. Main/preload edits rebuild, but do not restart Electron automatically: close the dev window and rerun `npm run dev` when your terminals and editors are safe to close. The launcher prints the checkout and renderer URL, and refuses to reuse an already-running server. Set `JANET_DEV_SERVER_URL` to another local port if needed.

The Hermes integration test needs Python 3. If it is not on PATH, set `JANET_TEST_PYTHON` to the Python executable (an absolute path is supported). CI provisions Python explicitly. PowerShell tests use the system module path rather than inheriting another application's PSReadLine.

To check the actual installed `hermes --tui` copy gesture on Windows, build JaneT, set `JANET_TEST_HERMES=1` in the test process environment, and run `npx playwright test tests/e2e/hermes-copy.spec.ts --repeat-each=3`. Hermes must already be installed and on PATH. This opt-in check uses temporary JaneT/Hermes profiles, no conversation prompts, and tests ordinary drag then Ctrl+Shift+C before and after a resize redraw. The regular terminal-copy suite also covers redraw retention without requiring Hermes.

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

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
