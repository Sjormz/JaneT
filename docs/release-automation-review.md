# Release automation review - 2026-09-16

Scope: add a repository shipping skill and audit CI/release safeguards. No
version bump, commit, push, PR, merge, tag, release or live ruleset change was
performed. Existing xterm-review changes were preserved.

## Findings and changes

| Finding | Change | Impact / remaining limit |
| --- | --- | --- |
| No project-specific code-to-release procedure for AI | Added `.agents/skills/ship-janet`, implicit trigger phrases, and AGENTS.md routing | One scoped flow from semver decision through verified publication; still requires actual shipping authority |
| Live rules require `Durable workspace` but CI emitted `Desktop smoke` | Restored the two stable required-check names | Removes check-name mismatch without weakening live protection |
| Manual recovery copied main's package.json without its lockfile onto tagged code | Removed overlay recovery; all jobs build the verified tag SHA | Reproducible source/dependency pairing; tooling/source fixes now need a new version |
| Tag source could be outside main, or change between matrix jobs | Strict stable tag format, main ancestry, event SHA and package/lock checks; downstream SHA pinning; pre-publish tag recheck | Prevents accidental non-main/hybrid releases; not a replacement for protected tag rules |
| Published assets could be overwritten and concurrent older versions promoted | Serialized publication with native pending queue; API guard rejects published tags, stable-version downgrades and moved tags | Existing unpublished drafts can still be retried; remote admin/manual writers remain outside workflow enforcement |
| Release verification drifted from CI | Exact Python 3.12 executable, one build before full E2E, failure traces, seven-day intermediate artifacts | Consistent Hermes tests and usable recovery evidence |
| Release guide/PR checklist omitted important gates | Updated exact-head checks, merge-SHA tagging, version rules, verification and recovery guidance | Avoids tagging an unrelated new main commit or treating an unrelated green run as proof |

The current release action already stages a new stable release until upload
completion. We kept that native behavior instead of adding a custom publisher.
CodeQL's existing workflow was reviewed and left unchanged.

## Live observations

- `main-approval-gate` requires Verify, both Durable workspace contexts and
  Analyze JavaScript/TypeScript; independent approval, CODEOWNERS, last-pusher
  approval, stale-review dismissal, resolved threads and squash merging remain.
- Auto-merge is disabled. A PR-only user bypass exists; the skill must not use it.
- Latest observed main CI run `34472473859` and Release run `34472591896` succeeded
  for `c95cecd81b4ddcb3754e4e3bac23e0f9d2f5b308`.
- Published `v0.11.1` had 11 nonempty uploaded assets. This audit inspected the
  API inventory, not downloaded installer bytes; it did not validate that old
  release's checksums anew.
- No tag-target ruleset appeared in the ruleset listing. Tag restrictions and
  GitHub immutable-release settings are follow-up hardening decisions requiring
  explicit authorization, not settings changed by this task.
- macOS remains deliberately ad-hoc signed and not notarized. The skill does
  not turn this alpha distribution policy into trusted production signing.

## Verification

Windows, Node `v22.23.2`, Python `3.12.14`, portable Git `2.55.0.windows.5`.
Dependencies and package versions were unchanged; the existing installed
lockfile dependency tree was used. No `npm ci` was necessary for this task.

- `npm.cmd run typecheck`: passed.
- `npm.cmd test -- tests/unit/releaseTooling.test.ts`: 26 passed, 1 platform skip.
- Official actionlint 1.7.12 (archive SHA-256 verified) passed before the native
  queue setting was added. Its schema rejects the two `queue: max` properties,
  although [GitHub's current syntax documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
  explicitly supports them. The remaining workflow checks pass with only that
  exact unsupported-key diagnostic filtered:
  `actionlint -shellcheck= -pyflakes= -ignore 'unexpected key .queue. for .concurrency. section' .github/workflows/ci.yml .github/workflows/release.yml .github/workflows/codeql.yml`.
  Queue values remain checked by the policy tests. ShellCheck/Pyflakes were not
  available; hosted validation remains untested.
- Skill frontmatter, UI metadata, implicit policy and referenced paths passed
  validation using existing `js-yaml`; the bundled Python validator could not
  run because PyYAML was absent. No dependency was added just for that validator.
- Independent Luna forward-review covered dirty work, feature vs fix, prepare
  vs ship authority, existing bumps, stale CI, missing approval, advanced main,
  failed releases and skill-authoring requests. This was a simulated review,
  not an actual release or a live Codex invocation test.
- Initial full test invocation encountered sandbox esbuild access restrictions
  and Git missing from PATH (18 failures). Correctly configured authorized runs
  removed those errors but exposed a repeatable full-workload timeout in the new
  policy test. Focused runs alone passed, so they were not accepted as a fix.
  Temporary timing diagnostics isolated the first expected VM rejection:
  valid checks finished in 11.8 ms, then the first error path took 11.6 seconds;
  YAML and policy checks were not the bottleneck. Neither disabling VM error
  annotation nor replacing the VM with an in-process function was reliable;
  both attempts were discarded. The final harness executes the actual inline
  guards in bounded, plain Node child processes, matching Actions' execution
  environment. Only API responses and candidate metadata are supplied as test
  inputs. It checks real success/failure and actual error messages (not text
  embedded in a command line). All guards and expected-error assertions remain.
  No timeout, retry or assertion was weakened. The first native-runtime full
  run passed, with the version-policy case taking 331 ms and publication-policy
  case 963 ms. This identifies a test-runner-sensitive error path, not an
  application or release-policy failure; no deeper V8/Vitest root cause is
  claimed.

Final verification repeated the focused case three times with `--retry=0`
(230-239 ms each), then ran the entire suite with
`npm.cmd test -- --reporter=json --outputFile=test-results/release-policy-native-final.json`:
**1268 passed, 0 failed, 8 skipped**. The formerly stalled version-policy case
took 321 ms and the publication-policy case 884 ms. The first native-runtime
full run also passed. An independent follow-up review confirmed no assertions
were weakened and the guards' GitHub API calls remain fully mocked.

The final normal full unit/component suite passed **1268 tests, 0 failed,
8 skipped** across 85 passing files. `npm.cmd run typecheck` and
`npm.cmd run build` passed on the final workflow and test implementation.

After building, the exact Windows smoke command below passed **26 tests,
0 failed, 0 skipped**:

```powershell
npx.cmd playwright test --config playwright.config.ts tests/e2e/dev-instance.spec.ts tests/e2e/close-shutdown.spec.ts tests/e2e/pane-maximize.spec.ts tests/e2e/terminal-copy.spec.ts tests/e2e/terminal-graphics.spec.ts tests/e2e/optional-workspace-setup.spec.ts tests/e2e/editor.spec.ts tests/e2e/settings-recovery.spec.ts tests/e2e/local-terminal-recovery.spec.ts
```

`npx.cmd playwright test --config playwright.config.ts` then passed the full
Windows E2E run: **52 passed, 0 failed, 5 skipped**. Skips were the opt-in
installed Hermes/screenshot capture cases, Windows-inapplicable path drag,
and two packaged-runtime-only updater cases. The final queue change does not
alter app source or the application tested by these desktop runs.

No hosted run of these uncommitted workflows, Linux/macOS execution, installer
packaging, notarization or actual publication was performed. Local checks do
not establish a green PR head or a shipped release.
