# Contributing to JaneT

Thanks for helping improve JaneT.

## Before you start

- Fork the repo if you are contributing from outside the project.
- Create a branch from `main`.
- Keep changes focused and small where possible.
- Make sure you can run the app locally before opening a PR.

## Local setup

```bash
npm install
npm run dev
```

## Validation

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

If you change Electron main-process code, preload code, or release behavior, make sure the build still succeeds after your changes.

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
