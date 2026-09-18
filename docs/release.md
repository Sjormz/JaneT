# Release process

JaneT releases are tag-driven and published by GitHub Actions.

`package.json` is the source of truth for the app version. Release tags must use the matching `vX.Y.Z` format, for example `v0.2.1` for package version `0.2.1`.

## What the release workflow does

When a `v*` tag is pushed, `.github/workflows/release.yml`:

1. Validates a stable `vX.Y.Z` tag, checks out its exact commit and proves it is
   on `main`. Manual dispatch must originate from `main`.
2. Verifies the tag matches `package.json` and both lockfile version fields
   before installing dependencies.
3. After the lightweight preparation job, runs the release verification gate on
   Ubuntu and all three platform packaging jobs in parallel:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - full Playwright E2E under Xvfb, using the build already produced
   - Python 3.12's exact executable for Hermes tests, matching CI
4. Builds release artifacts on Linux, macOS, and Windows from the prepared
   commit SHA, not a freshly resolved mutable tag; publication waits for both
   verification and packaging to pass.
5. Verifies the exact installer/update-metadata set and starts a real PTY with
   each runner's packaged Electron runtime.
6. Verifies the Apple Silicon macOS build uses an ad-hoc code signature.
7. Serializes publication, refuses an already-public version or a version older
   than a published stable release, and rechecks the tag's source SHA.
8. Uploads installers and update metadata. The release action stages a new
   release as a draft until uploads finish; only an unpublished draft may have
   its assets replaced on retry.

After the small prepare job validates the tag, version and source SHA, full
verification and the three platform package jobs run in parallel. Publication
still waits for both paths to succeed.

The app uses `electron-updater` with GitHub Releases, so the generated `latest*.yml` assets must stay attached to the release.
Temporary Actions artifacts used between the package and publish jobs expire
after seven days. Published GitHub Releases and tags are retained.
The macOS ZIP blockmap must also be published for differential updates. DMG
blockmap generation is disabled because JaneT does not publish or consume those
files. The release check executes the Apple Silicon runner's packaged macOS PTY.

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

JaneT currently locks `node-pty` 1.2.0-beta.14, which contains the upstream
ConPTY fixes from [PR #885](https://github.com/microsoft/node-pty/pull/885) and
the Windows handle fix from #922. The postinstall step keeps only JaneT's
packaging-specific worker-path rewrite so a worker loaded from `app.asar` runs
from `app.asar.unpacked`.

The `afterPack` hook copies the bundled `conpty.dll` and `OpenConsole.exe` beside
any rebuilt `build/Release` or `build/Debug` native module before signing.
`node-pty` prefers those modules over its prebuild, so leaving the DLLs only in
the prebuild directory breaks packaged terminal startup.

The Windows release verifier checks every packaged native module has its DLL
payload, verifies the unpacked worker path survived packaging, then exercises
the packaged module with a real ConPTY input/output round trip using the bundled
ConPTY DLL, matching the app's Kitty graphics passthrough path. Keep the worker
path check until the packaging layout no longer needs this rewrite.

## Required repository ruleset

The `main-approval-gate` GitHub ruleset protects `refs/heads/main`.

It should require these status checks before merge:

- `Verify`
- `Durable workspace (macos-latest)`
- `Durable workspace (windows-latest)`
- `Analyze JavaScript/TypeScript`

It should also keep these pull request rules enabled:

- one approving review
- CODEOWNERS review
- stale review dismissal after new pushes
- last-pusher approval requirement
- review thread resolution
- squash-only merging

The platform jobs run desktop smoke tests but retain their `Durable workspace`
display names because those names are required-check contexts. Change workflow
names and live rules together only with explicit authorization. The skill must
not use a bypass actor or `gh pr merge --admin` to get around these gates.

## Label-gated automatic release handoff

Create the repository label `release` once, then apply it to a reviewed PR only
when that PR also contains the intended version update. After such a PR is
merged to `main`, `.github/workflows/release-handoff.yml`:

1. Confirms the PR was merged with the `release` label.
2. Treats an unchanged package version as a no-op.
3. Requires a strict version increase with matching package and lockfile root
   versions.
4. Waits for `Verify`, both durable-workspace platform checks and CodeQL to
   succeed on the exact merge SHA.
5. Rechecks published versions, releases and tags, then creates one annotated
   tag on that merge SHA without forcing or moving another tag.
6. Explicitly dispatches `release.yml` for the tag. The Actions token's tag push
   is not assumed to start another workflow.

Merged PRs without the label do nothing. A labeled PR without a version change
also does nothing. Any invalid version, failed check, existing tag/release or
API failure stops before publication. The manual process below remains the
recovery path when the automatic handoff is unavailable.

### First installation

The privileged handoff runs its helper from the PR's **pre-merge base**, not
from the newly merged code. The PR that first installs the helper cannot use
it to release itself. Bootstrap that one release with the manual tag flow
below, after the merge checks pass. Later release PRs should branch from main
containing the helper and need only the version update, `release` label, and
merge. Re-running the installation event does not change its old base SHA.

PR #144 installed the helper; its v0.11.5 release used this one-time bootstrap.
There is no additional release button or service to configure.

## Recommended PR-only release flow

The repository skill at [`.agents/skills/ship-janet/SKILL.md`](../.agents/skills/ship-janet/SKILL.md)
automates this flow when asked "let's ship this" or "get this out to prod".
Explicit invocation is `$ship-janet`. "Prepare", "review" and "dry-run" do not
authorize remote publication. The skill uses the existing CLI and workflows;
it does not bypass independent review or create a separate release service.

The checklist below is also suitable for a human release operator. Use the
actual repository, PR number and verified SHAs in place of placeholders.

### 1. Establish the candidate

Inspect the current branch, dirty files, open PRs, origin/main, tags and latest
published release first. Do not switch branches over dirty work or include
unrelated commits. Use a scoped branch or clean worktree. Fetch main and tags
without forcing existing tags. Review all changes since the latest published
stable version, including work already merged but not yet released.

### 2. Prepare the release version in a PR

Choose the right semver bump:

- `patch` for bug fixes and internal maintenance
- `minor` for user-visible features that remain backward-compatible
- breaking changes require an explicit version/migration decision; do not
  silently publish a major or promote this 0.x application to 1.0

For mixed changes choose the highest applicable level. Docs/CI/skill-only work
normally needs no app release; an explicit request to publish it uses patch.
Reuse an already-correct unreleased version bump. Check that the version is
newer than published versions and the tag is not already used for another SHA.

Create the release PR from a normal scoped branch; no special release branch is
required for the label handoff. Add the `release` label before merging when the
PR is intended to publish.

```bash
npm version patch --no-git-tag-version
```

That updates `package.json` and `package-lock.json` without creating the tag yet.

### 3. Verify locally

Use CI's Node major (currently 22), record the exact version and OS, and run
`npm ci` for a fresh checkout or changed dependencies/lockfile. Set
`JANET_TEST_PYTHON` to a verified Python executable. Test fixtures use isolated
profiles; do not use the installed app profile. Clear inherited
`ELECTRON_RUN_AS_NODE` and `ELECTRON_NO_ATTACH_CONSOLE`.

```bash
node --version
npm run typecheck
npm test
npm run build
npx playwright test --config playwright.config.ts
```

The final command is `npm run test:e2e` without its redundant rebuild. On Linux
prefix it with `xvfb-run --auto-servernum`. Also run the desktop smoke command
from `ci.yml` on the available desktop OS. Follow `AGENTS.md` for failure/flake
investigation. Record command results, counts, skips and untested platforms.

### 4. Open and merge the release PR

Stage only the reviewed scope, including both version files. Commit, push the
scoped branch and create/update a PR with version rationale and test evidence.
Add the `release` label when this PR is intended to publish.
Read live required checks and reviews; inspect the current PR head SHA. Wait
for required independent approval and passing checks. Auto-merge is not assumed
available. A missing human approval is a blocker, not permission to bypass.

Merge with `gh pr merge <number> --squash --match-head-commit <verified-head-sha>`.
Read back the merged PR and its `mergeCommit.oid`; do not assume a successful
command means an auto-queued PR already merged.

### 5. Tag the merged `main` commit (manual fallback)

Normally the label handoff performs this step. Use it manually only if the
handoff was intentionally omitted or failed before tagging. Fetch main again.
Verify the exact merge SHA is on origin/main, its package and
lock versions agree, and CI/CodeQL for that SHA passed. If main advanced, inspect
what would be excluded; never silently tag new unreviewed code. Recheck remote
tags and concurrent releases before tagging.

```bash
git tag -a vX.Y.Z <verified-merged-sha> -m "Release vX.Y.Z"
git push origin refs/tags/vX.Y.Z
```

Push only the intended tag, never `--tags` or `--force`. If the remote tag already
exists at the same SHA, resume monitoring; a different SHA is a hard stop.
The authenticated developer push starts Release. A tag push made with an Actions
`GITHUB_TOKEN` normally does not trigger another workflow; do not substitute it
for this flow and assume release automation ran.

### 6. Watch the release

Find the Release run by the exact tag and source SHA, not merely the newest run.
Record its ID and use `gh run watch <run-id> --exit-status`. For manual dispatch,
inspect the tag input and source verification log: the run's event SHA can be
main while the packaged source is the requested tag.

Confirm the release includes the expected platform artifacts:

- Windows installer and portable executable
- macOS Apple Silicon dmg/zip artifacts and the ZIP blockmap
- Linux AppImage/deb artifacts
- `latest*.yml` update metadata files

Use `expectedReleaseArtifacts` in `scripts/verify-release-artifacts.mjs` as the
exact filename contract (currently 11 assets). Require uploaded, nonempty files.
Download assets into a disposable directory, separate each platform's files,
then use the existing `verifyReleaseManifest(platform, version, directory)`
export to verify manifest versions, sizes and SHA-512 values. This is not the
packaged-runtime CLI, which also needs unpacked app directories.

Confirm the tag still resolves to the expected SHA and the release is public,
non-draft and non-prerelease. Confirm GitHub's latest-release endpoint identifies
this version, or explain a newer concurrent release. Report the PR, merged SHA,
tag, run ID, release URL and verification before saying "shipped".

## Manual release workflow dispatch

The release workflow also supports `workflow_dispatch` with a tag input from
`main`. Use it only to retry an **unpublished** existing tag after a transient
infrastructure failure. Prefer rerunning the failed original run when possible.
It checks out the exact tagged source and lockfile; it never overlays newer
`main` files. A source, dependency or packaging-tooling fix needs a new reviewed
version and tag. If the run predates these safeguards, inspect its workflow
before choosing a retry; reruns use that run's original workflow revision.

An incomplete draft is not shipped. Inspect the failed run and draft assets;
retrying the unchanged candidate may replace its unpublished assets. A public
release is immutable in this process, even if someone later asks to rerun it:
verify it and stop, or publish a new patch for a correction. Never unpublish,
delete or retag a public release as a recovery shortcut.

Do not use manual dispatch to publish a version that has not been committed and tagged.

## Do not do these

- Do not edit version numbers directly on `main` without a PR.
- Do not create a release tag that does not match `package.json`.
- Do not delete `latest*.yml` release assets; they are used by auto-update.
- Do not build public release assets only from a local machine.

## Automation boundaries and references

The skill cannot supply a human approval, signing credentials or missing GitHub
permissions. Tag rules and GitHub immutable-release settings are additional
repository controls, not changed by installing the skill. The workflow's
ancestry check proves the source is on main; it does not prove a particular PR
review happened. The operator/skill must enforce the review and exact-SHA gates.

Release concurrency uses GitHub's native `queue: max` (up to 100 waiting jobs or
runs); publication order follows readiness, not semantic version order. The
version guard refuses an older version if a newer one already published.
Canceled runs are not successful releases: inspect concurrent versions before
retrying. Workflow preflight checks are not an atomic lock against manual/API
tag or release changes outside Actions; repository-level tag protection and
immutable releases are the appropriate additional controls for that race.

This remains alpha-stage desktop distribution, not notarized macOS production
distribution. Signing-policy changes require a separate decision.

- [Codex repository skills and implicit invocation](https://learn.chatgpt.com/docs/build-skills)
- [GitHub CLI head-SHA-bound merging](https://cli.github.com/manual/gh_pr_merge)
- [Release action upload/finalization behavior](https://github.com/softprops/action-gh-release)
- [GitHub token workflow-trigger restrictions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Native concurrency queue semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
