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
5. Verifies the exact installer/update-metadata set and starts a real PTY with
   each runner's packaged Electron runtime.
6. Verifies both macOS architectures use ad-hoc code signatures.
7. Uploads installers and update metadata to the matching GitHub Release.

The app uses `electron-updater` with GitHub Releases, so the generated `latest*.yml` assets must stay attached to the release.
The macOS ZIP blockmaps must also be published for differential updates. The
release check executes the runner's native macOS PTY. It avoids translated
cross-architecture execution because Rosetta startup on disposable hosted
runners is nondeterministic, while always validating both architecture bundles'
signatures, native module/helper layout, and executable permissions.

### macOS release signing

macOS release artifacts are deliberately ad-hoc signed and are not notarized.
The release workflow passes `identity=-`, disables hardened runtime and
notarization, disables automatic certificate discovery, and preserves
node-pty's packaged Darwin prebuilds, including their existing signatures,
instead of rebuilding or recursively re-signing those two native files. No
Apple signing credentials are required for this release profile. `npm run
dist:mac:test` uses the same settings for local smoke packages.

An ad-hoc signature verifies code integrity, but it does not establish a
trusted developer identity or satisfy Gatekeeper's normal trust checks.
Downloaded builds can therefore show a security warning or require the user to
open JaneT explicitly from Finder. This is an alpha-stage distribution policy;
a future generally trusted macOS release must restore Developer ID signing and
Apple notarization.

### Windows ConPTY packaging

JaneT currently locks `node-pty` 1.1.0. Its postinstall step applies an
idempotent backport of [upstream node-pty PR #885](https://github.com/microsoft/node-pty/pull/885),
which defers the native ConPTY pipe connection until the output worker reports
ready. Without that ordering fix, constrained Windows CI runners can block the
Node event loop inside `ConnectNamedPipe` before a JavaScript timeout can run.

The Windows release verifier checks that the backport and unpacked worker path
survived packaging, then exercises the packaged module with a real ConPTY
input/output round trip. Keep this backport guarded against dependency-source
drift until JaneT upgrades to a stable `node-pty` release that contains the
upstream fix.

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
- macOS dmg/zip artifacts and both ZIP blockmaps
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
