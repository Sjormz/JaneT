# Release process

JaneT releases are tag-driven and published by GitHub Actions.

`package.json` is the source of truth for the app version. Release tags must use the matching `vX.Y.Z` format, for example `v0.2.1` for package version `0.2.1`.

## What the release workflow does

When a `v*` tag is pushed, `.github/workflows/release.yml`:

1. Checks out the tagged commit.
2. Verifies the tag version matches `package.json`.
3. Runs the release verification gate on Ubuntu:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run test:e2e` under Xvfb
4. Builds release artifacts on Linux, macOS, and Windows.
5. Uploads installers and update metadata to the matching GitHub Release.

The app uses `electron-updater` with GitHub Releases, so the generated `latest*.yml` assets must stay attached to the release.

## Required repository ruleset

The `main-approval-gate` GitHub ruleset protects `refs/heads/main`.

It should require these status checks before merge:

- `Verify`
- `Analyze JavaScript/TypeScript`

It should also keep these pull request rules enabled:

- one approving review
- CODEOWNERS review
- stale review dismissal after new pushes
- last-pusher approval requirement
- review thread resolution
- squash-only merging

## Recommended PR-only release flow

Use this when preparing a normal release.

### 1. Start from an up-to-date `main`

```bash
git checkout main
git pull origin main
npm ci
```

### 2. Create a release branch

Choose the right semver bump:

- `patch` for bug fixes and internal maintenance
- `minor` for user-visible features that remain backward-compatible
- `major` for breaking changes

```bash
git checkout -b release/v0.2.1
npm version patch --no-git-tag-version
```

That updates `package.json` and `package-lock.json` without creating the tag yet.

### 3. Verify locally

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

### 4. Open and merge the release PR

```bash
git add package.json package-lock.json
git commit -m "chore(release): v0.2.1"
git push -u origin release/v0.2.1
gh pr create --title "chore(release): v0.2.1" --body "Bumps JaneT to v0.2.1."
```

Wait for CI, request review, and merge the PR.

### 5. Tag the merged `main` commit

```bash
git checkout main
git pull origin main
git tag v0.2.1
git push origin v0.2.1
```

Pushing the tag starts the release workflow.

### 6. Watch the release

```bash
gh run list --workflow Release --limit 1
gh run watch
```

When it completes, open the release page:

```bash
gh release view v0.2.1 --web
```

Confirm the release includes the expected platform artifacts:

- Windows installer and portable executable
- macOS dmg/zip artifacts
- Linux AppImage/deb artifacts
- `latest*.yml` update metadata files

## Manual release workflow dispatch

The release workflow also supports `workflow_dispatch` with a tag input. Use it only to rerun publishing for an existing tag after fixing workflow/infrastructure problems.

Do not use manual dispatch to publish a version that has not been committed and tagged.

## Do not do these

- Do not edit version numbers directly on `main` without a PR.
- Do not create a release tag that does not match `package.json`.
- Do not delete `latest*.yml` release assets; they are used by auto-update.
- Do not build public release assets only from a local machine.
