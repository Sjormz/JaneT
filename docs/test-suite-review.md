# Test suite review — 27 October 2026

Reviewed all 123 unit, component and Electron test files, including their cases, matrices, fixtures and skips. The audit keeps distinct behavior, security, migration, data-loss and concurrency coverage. File size alone is not a reason to delete a regression check.

The starting suite contained 1,141 test definitions (matrix rows expand at runtime). The reviewed suite contains 1130 definitions across the same 123 files. The Electron collection has 63 expanded cases, including documented platform/opt-in cases. Counts are not a coverage target: removed checks were redundant, obsolete or vacuous, and replacements assert the actual contract.

## Repairs before the audit

- Dirty-editor cancellation passed its UI assertion but left an unresolved dirty-close fixture for Windows profile deletion. Resolve it by explicitly discarding and observing the original window close before cleanup.
- Three selected-control palettes violated the existing 7:1 contrast gate. Adjust the actual theme colors, keep the gate, refresh the affected public screenshots and review them in One Dark.
- Child process exit can precede inherited stream closure. Shared teardown now observes normal quit, bounds the owned-process fallback, and waits for complete stream closure before profile deletion. Unit regression coverage proves the event order.

The complete repair suite passed on [repair head 13b6f3c](https://github.com/Sjormz/JaneT/actions/runs/40499091266) on Linux, Windows and Apple Silicon, with a separate [Intel macOS run](https://github.com/Sjormz/JaneT/actions/runs/40499086745). Windows packaging and packaged PTY checks passed too. Older native startup stalls did not recur in those runs; their underlying cause was not established by a passing rerun.

## Audit changes

- Replaced empty-content, emptied-fixture-array and conditional identity assertions that could pass without exercising their claim. Split unsafe-control, CIM-shape and close-route cases into independent checks.
- Removed obsolete SSH validation rows that only rejected a removed top-level key; retained explicit rejection and safe upgrade migration. Consolidated eight cleanup cases into three stronger ordered/error/invalid-entry cases, removed an unused duplicate boolean matrix, and retired a fake-browser Electron case now covered by shared lifecycle units.
- Reused one native environment sanitizer and one string DataTransfer fixture. Pane scenarios use shared bounded native launch/cleanup, with explicit ownership of apps and temporary folders.
- Replaced persistence sleeps and repeated shortcut actions with observable saved state and registered-action readiness. Native motion input now uses a ready PTY consumer instead of mixing animation behavior with shell command parsing.
- Added native Windows path-drop coverage, strengthened shell probe exit/marker checks, made rename execution markers distinct from typed text, and made design capture gaps fail visibly.

The [focused hosted repetition run](https://github.com/Sjormz/JaneT/actions/runs/40503321362) passed without retries on Linux, Windows, Intel macOS and Apple Silicon: 20 motion cases on each, plus three repetitions of every applicable pane/path/protocol case. This is focused evidence, not final verification of later commits.

## Verification and coverage limits

Final merge acceptance remains the current PR head: typecheck, the entire unit/component suite, build, full Linux/Windows/macOS Electron selections, macOS TUI repetitions and Windows native package/PTY verification. Final head SHA, run links and observed pass/skip counts are recorded in [PR #204](https://github.com/Sjormz/JaneT/pull/204); an earlier green commit does not verify later changes. Use Node 24.19.0, npm 11.17.0, the lockfile and the workflow-provisioned Python 3.12.

- Full macOS runs distinguish Intel `macos-26-intel` from Apple Silicon `macos-26`.
- Installed Hermes copy requires `JANET_TEST_HERMES` and an installed executable. It remains an explicit external-integration opt-in.
- Packaged UI diagnostics/updater cases now run in Windows CI against its freshly built unpacked executable, with separate traces/JUnit evidence. Other packaged platforms require `JANET_PACKAGED_EXECUTABLE`; native Windows package/PTY verification remains a separate gate.
- Public screenshot generation is a Windows asset-maintenance opt-in; design captures are an opt-in developer visual review tool. They are retained for their documented workflows.
- Native protocol activation is Windows-only. POSIX shell and filesystem cases retain explicit platform/installed-shell conditions. Skips must be reported from the run, not treated as passes.
- Negative-observation windows in no-submit/no-auto-retry tests and the historical delayed-startup fallback checks are retained where they test the absence of an action. They are not substitutes for positive readiness markers.

Test maintenance changes do not alter app user steps. The actual palette change is documented in the Settings guide with refreshed public screenshots; the remaining audit needs developer documentation only.

## Per-file disposition

The table records every reviewed file. Definition counts are source declarations, not expanded runtime totals. “Retain” means its cases cover distinct contracts and were not deleted merely because lower-level tests also exist.

### Unit

| File | Definitions | Disposition |
| --- | ---: | --- |
| [activityDiagnostics.test.ts](../tests/unit/activityDiagnostics.test.ts) | 1 | Keep bounded opt-in logging, redaction, overflow and I/O failure coverage. |
| [agentActivityBridge.test.ts](../tests/unit/agentActivityBridge.test.ts) | 4 | Keep HTTP capability, removed identities, private fields and real bundled helper boundaries. |
| [agentCliLaunch.test.ts](../tests/unit/agentCliLaunch.test.ts) | 6 | Keep simultaneous 12-caller migration and every result, saved config, native PowerShell argv and real helper behavior. No serialization or warning-only passes. |
| [agentOsc.test.ts](../tests/unit/agentOsc.test.ts) | 4 | Keep independent bounded decoder and invalid event/provider/version matrix. |
| [buildShellInit.test.ts](../tests/unit/buildShellInit.test.ts) | 43 | Require marker presence before ordering comparisons; retain real Bash/Zsh/Fish/PowerShell escaping, hook composition, status and prompt integration. |
| [claudeActivity.test.ts](../tests/unit/claudeActivity.test.ts) | 9 | Keep real shell/helper argument and input framing checks distinct from mapper tests; timer is a subprocess deadline, not synchronization. |
| [clipboardBridge.test.ts](../tests/unit/clipboardBridge.test.ts) | 7 | Keep main/preload IPC checks; multiline selection and safe shell token are different trust contracts. |
| [codexActivitySetup.test.ts](../tests/unit/codexActivitySetup.test.ts) | 13 | Keep real file preservation, original notifier restoration, lock ownership, atomic rollback, junction and reader/edit race checks. |
| [codexNotify.test.ts](../tests/unit/codexNotify.test.ts) | 5 | Keep TOML boundary preservation and nested legacy/computer-use wrapper regression. |
| [commandHistory.test.ts](../tests/unit/commandHistory.test.ts) | 10 | Keep legacy normalization, proxy/accessor rejection and independent deep clones. |
| [commandNotifications.test.ts](../tests/unit/commandNotifications.test.ts) | 4 | Keep strict payload validation and getter/proxy privacy guards. |
| [controlStyles.test.ts](../tests/unit/controlStyles.test.ts) | 2 | Retain style-contract guards for target size, focus, disabled state and semantic tokens; native geometry is checked separately. |
| [editorDocuments.test.ts](../tests/unit/editorDocuments.test.ts) | 6 | Keep model ownership, language matrix and dirty-state contracts. |
| [electronLifecycle.test.ts](../tests/unit/electronLifecycle.test.ts) | 7 | Retain deadline, stalled-CDP and owned-child shutdown cases; added exit-before-stdio-close regression and isolated native environment check. |
| [externalUrls.test.ts](../tests/unit/externalUrls.test.ts) | 2 | Keep allowlist positive/negative protocol matrix. |
| [gitManager.test.ts](../tests/unit/gitManager.test.ts) | 30 | Retain real Git operations, canonical containment, option safety, worktree resolution, timeout and credential-redaction checks. |
| [gitStatus.test.ts](../tests/unit/gitStatus.test.ts) | 2 | Keep count/title projection and stale-state distinction. |
| [gitWorktrees.test.ts](../tests/unit/gitWorktrees.test.ts) | 5 | Keep porcelain parsing, path-template and UNC/relative-base behavior. |
| [hermesActivitySetup.test.ts](../tests/unit/hermesActivitySetup.test.ts) | 10 | Retain YAML/comments/consent, profile selection, safe-mode, linked-directory and lifecycle identity checks. |
| [hermesAgentPlugin.test.ts](../tests/unit/hermesAgentPlugin.test.ts) | 1 | Retain real Python manifest/hook decoding, gateway protocol isolation, child-session and proxy output guards. |
| [keybindings.test.ts](../tests/unit/keybindings.test.ts) | 27 | Retain platform defaults, migration/collisions, AltGr/Cyrillic/Dvorak layouts, copy/paste and interrupt ownership. |
| [kittyGraphics.test.ts](../tests/unit/kittyGraphics.test.ts) | 1 | Keep bounded upstream addon options and absence of second protocol/image implementation. |
| [mainRefreshIO.test.ts](../tests/unit/mainRefreshIO.test.ts) | 7 | Retain bounded filesystem/Git refresh invalidation and main-process path/context guards. |
| [materialStyles.test.ts](../tests/unit/materialStyles.test.ts) | 5 | Keep packaged Chromium prefix regression, opacity floors and cross-process palette/token parity. |
| [monacoTheme.test.ts](../tests/unit/monacoTheme.test.ts) | 1 | Keep Monaco scheme/token parity across every built-in theme. |
| [motionTokens.test.ts](../tests/unit/motionTokens.test.ts) | 3 | Keep CSS/WAAPI parity and semantic token contracts. |
| [nativeBuildDownload.test.ts](../tests/unit/nativeBuildDownload.test.ts) | 1 | Keep dependency regression for truncated/backpressured native-build HTTP response. Intentional unread-body dwell exercises FIN under backpressure. |
| [notificationBridge.test.ts](../tests/unit/notificationBridge.test.ts) | 28 | Retain strict payload/getter/proxy rejection, privacy-safe main-owned diagnostics, settings recovery and native activation mapping. |
| [osc7.test.ts](../tests/unit/osc7.test.ts) | 24 | Keep URL decoding and local-authority matrix; raw, encoded, once-only and UTF-8 validation exercise distinct boundaries. |
| [processInspector.test.ts](../tests/unit/processInspector.test.ts) | 6 | Added independent singleton and array CIM inputs; retain malformed entries, PID identity and process-tree parsing. |
| [refreshCoordinator.test.ts](../tests/unit/refreshCoordinator.test.ts) | 8 | Keep fake-clock scheduling/coalescing/visibility and registration lifetime checks; no wall-clock polling. |
| [releaseTooling.test.ts](../tests/unit/releaseTooling.test.ts) | 34 | Use installed direct YAML parser and finally-clean owned publication fixtures. Retain runtime pins, protected jobs, release guards, manifests, provenance and documented release contracts. |
| [rendererEvents.test.ts](../tests/unit/rendererEvents.test.ts) | 1 | Keep destruction-during-send guard and successful payload delivery. |
| [rendererProtocol.test.ts](../tests/unit/rendererProtocol.test.ts) | 12 | Keep origin, method, containment, malformed encoding and generic error/privacy boundary matrix. |
| [runCleanup.test.tsx](../tests/unit/runCleanup.test.tsx) | 3 | Consolidated redundant function/disposable checks and remove misleading duplicate disposable test. Retain order, invalid entries, and progress after both throw types. |
| [semanticCommands.test.ts](../tests/unit/semanticCommands.test.ts) | 19 | Keep buffer/cell semantics, monotonic timing, start/completion/cancel, marker lifetime, bounds and alternate screen. Fake active terminal supports one timeline per case as used. |
| [sessionMigration.test.ts](../tests/unit/sessionMigration.test.ts) | 19 | Keep every project/session merge, global budget, worktree identity, selection/maximization and idempotency case. Historical fixtures still protect user upgrades. |
| [sessionRestore.test.ts](../tests/unit/sessionRestore.test.ts) | 28 | Retain structural path round trips, fresh IDs, legacy remote removal, project migration and independent traversal/terminal budgets. |
| [SettingsManager.test.ts](../tests/unit/SettingsManager.test.ts) | 58 | Removed obsolete SSH profile-field/count/duplicate rows, which now short-circuit on unknown top-level field. Keep explicit remote-settings rejection and migration that drops remote commands. Preserve atomic writes, budgets, recovery and schema migration. |
| [settingsRecovery.test.ts](../tests/unit/settingsRecovery.test.ts) | 7 | Keep byte-exact previous-generation recovery, no silent overwrite and explicit reset. |
| [snippets.test.ts](../tests/unit/snippets.test.ts) | 3 | Keep name normalization, editing identity and no-submit paste behavior. |
| [startupCommands.test.ts](../tests/unit/startupCommands.test.ts) | 12 | Redesigned unsafe controls as eight independent rows with valid neighbors; retain all-or-nothing parsing and shell dialect limits. |
| [terminal.test.ts](../tests/unit/terminal.test.ts) | 39 | Fixed two vacuous ptys.every assertions after shift empties the fixture array. Keep lifecycle, generation, flow-control, shell and PID identity coverage. Ensure mock managers release shell-init directories even on assertion failures. |
| [terminalAwareness.test.ts](../tests/unit/terminalAwareness.test.ts) | 8 | Keep phase/outcome/session/turn identity transitions and unavailable transport projection. |
| [terminalCapacity.test.ts](../tests/unit/terminalCapacity.test.ts) | 3 | Keep independent owner accounting and duplicate/repeated-release guards. |
| [terminalClipboard.test.ts](../tests/unit/terminalClipboard.test.ts) | 1 | Keep real UTF-8/base64 decoder ceiling, malformed input and read rejection. |
| [terminalClipboardImage.test.ts](../tests/unit/terminalClipboardImage.test.ts) | 2 | Keep unique session files, plain text fallback, cleanup and oversized image rejection. |
| [terminalDiagnostics.test.ts](../tests/unit/terminalDiagnostics.test.ts) | 2 | Keep opt-in logging and output-free control names. |
| [terminalManager.test.ts](../tests/unit/terminalManager.test.ts) | 7 | Keep native exit, resize eviction, ownership, fallback timer cancellation and exact write-size boundaries. |
| [terminalPathDrag.test.ts](../tests/unit/terminalPathDrag.test.ts) | 7 | Keep typed payload/interoperability and shell-specific injection-safe quoting; legacy remote rejection is migration protection. |
| [terminalSmokeScript.test.ts](../tests/unit/terminalSmokeScript.test.ts) | 1 | Keep real host Node ABI PTY spawn/output proof; packaged Electron ABI is separately tested. |
| [textFileIO.test.ts](../tests/unit/textFileIO.test.ts) | 10 | Retain canonical handles, revision/atomic-replacement/link/overwrite checks and simultaneous writers. Always release and settle the injected rename gate on failure. |
| [themes.test.ts](../tests/unit/themes.test.ts) | 11 | Retain every built-in palette and selected-control contrast; three palette values fixed without lowering the 7:1 requirement. |
| [types.test.ts](../tests/unit/types.test.ts) | 30 | Made repeated split identity checks unconditional for both axes; retain move/remove/resize and stable object identity checks. |
| [updater.test.ts](../tests/unit/updater.test.ts) | 16 | Keep all trust, concurrency, version identity, stale results and shutdown/install ordering cases; controlled promises retain simultaneous callers. |
| [useGitRepository.test.tsx](../tests/unit/useGitRepository.test.tsx) | 4 | Keep shared refresh/stale response/error-recovery checks with controlled promises. |
| [visualPrimitives.test.tsx](../tests/unit/visualPrimitives.test.tsx) | 11 | Retain accessible primitive labels, token/style integration and interaction contracts. |
| [windowMaterial.test.ts](../tests/unit/windowMaterial.test.ts) | 5 | Keep explicit platform/build matrix and avoid redundant native window reconfiguration. |
| [workspaceCloseBridge.test.ts](../tests/unit/workspaceCloseBridge.test.ts) | 10 | Retain renderer/request identity, fake-clock timeout, explicit user acknowledgement, renderer loss and shared preload subscription cleanup. |
| [workspaceDirectories.test.ts](../tests/unit/workspaceDirectories.test.ts) | 5 | Keep real filesystem naming, containment, links, worktree/submodule and no merge/data loss checks. |
| [workspaceFileOperations.test.ts](../tests/unit/workspaceFileOperations.test.ts) | 21 | Keep every destructive-operation ownership, rollback, external-write and nested Git-link check. |
| [workspaceGroups.test.ts](../tests/unit/workspaceGroups.test.ts) | 7 | Keep segment-aware ownership, legacy project inference, Library and session migration distinctions. |
| [workspaceLifecycle.test.ts](../tests/unit/workspaceLifecycle.test.ts) | 8 | Keep controlled prepare/stop/quit ordering, cancellation and coalescing. Update preparation gate intentionally does not stop resources. |
| [zshStartupShims.test.ts](../tests/unit/zshStartupShims.test.ts) | 6 | Added explicit subprocess exit-status checks; retain replay and real-Zsh startup-file ordering as distinct coverage. |

### Component

| File | Definitions | Disposition |
| --- | ---: | --- |
| [AddTerminalsDialog.test.tsx](../tests/component/AddTerminalsDialog.test.tsx) | 1 | Keep independent terminal type matrix and requested count with no accidental name field. |
| [CommandHistoryPicker.test.tsx](../tests/component/CommandHistoryPicker.test.tsx) | 14 | Replace assertions about absent historical labels with the actual named search-combobox contract; retain filtering/removal, keyboard and focus behavior. |
| [CommandPalette.test.tsx](../tests/component/CommandPalette.test.tsx) | 15 | Retain query/category matching, native keyboard navigation and selection/focus handoff; component assertions complement native integration. |
| [ConfirmationDialog.test.tsx](../tests/component/ConfirmationDialog.test.tsx) | 4 | Keep safe default focus, portal semantics, explicit confirmation, focus trap and restored opener. |
| [EmptyWorkspace.test.tsx](../tests/component/EmptyWorkspace.test.tsx) | 2 | Keep parent-specific routing and fresh-profile destination choices. |
| [FileExplorer.test.tsx](../tests/component/FileExplorer.test.tsx) | 9 | Share the string DataTransfer fixture; retain late navigation, safe absolute paths, folder copy and accessible rows. |
| [GitTree.test.tsx](../tests/component/GitTree.test.tsx) | 36 | Share DataTransfer fixture and await status renders/actions in act. Retain same-batch mutation locking, worktree MRU, destructive confirmation and stale/error recovery. |
| [KeybindingsContext.test.tsx](../tests/component/KeybindingsContext.test.tsx) | 7 | Retain handler registration/unregistration, collisions and terminal/native-key ownership; platform maps are independently tested. |
| [MainDirectory.test.tsx](../tests/component/MainDirectory.test.tsx) | 2 | Keep failed-save recovery and native directory selection. |
| [MonacoDiffEditor.test.tsx](../tests/component/MonacoDiffEditor.test.tsx) | 1 | Keep model/editor lifetime across appearance updates and exact disposal at unmount. |
| [MotionPresence.test.tsx](../tests/component/MotionPresence.test.tsx) | 4 | Keep controlled animation completion, interaction removal, stale exit cancellation and live reduced-motion preference. |
| [RenameDialog.test.tsx](../tests/component/RenameDialog.test.tsx) | 1 | Keep direct prop-change input reset; integrated rename actions are tested separately. |
| [SearchOverlay.test.tsx](../tests/component/SearchOverlay.test.tsx) | 7 | Redesigned duplicated action cases as independent keyboard/button matrices with accessible queries and fresh spies. Replace vacuous empty-string assertion with empty DOM and check focus selection. |
| [ShortcutEditor.test.tsx](../tests/component/ShortcutEditor.test.tsx) | 10 | Split three close routes into independent exact-once cases; retain recording, collision and reset behavior. |
| [Sidebar.test.tsx](../tests/component/Sidebar.test.tsx) | 10 | Retain roving tool tabs, layout without remounting, contextual callbacks, collapsed content removal and focus safety. |
| [SnippetPicker.test.tsx](../tests/component/SnippetPicker.test.tsx) | 7 | Remove a tautology about unchanged fixture text and require exact-once selection. Real no-submit behavior remains in snippet/terminal/app integration tests. |
| [SplitPane.test.tsx](../tests/component/SplitPane.test.tsx) | 114 | Remove an unused boolean matrix that repeated the same case; wait for saved layouts instead of two 700 ms sleeps, press shortcuts once, and flush asynchronous split setup. Retain all distinct app persistence, dirty-close, ownership, migration, capacity and focus races. |
| [StatusBar.test.tsx](../tests/component/StatusBar.test.tsx) | 4 | Retain abbreviated display/full accessible path, stale Git state and version action contracts. |
| [TerminalPane.test.tsx](../tests/component/TerminalPane.test.tsx) | 50 | Share DataTransfer fixture. Retain cached-session lifetime, deferred create/retry/resize, parsed-output acknowledgements, platform keys, selection, OSC privacy and broadcast ownership cases. |
| [TerminalPathCopyButton.test.tsx](../tests/component/TerminalPathCopyButton.test.tsx) | 4 | Retain safe absolute-path copy, pending action, failure and late completion behavior. |
| [ThemeSwitcher.test.tsx](../tests/component/ThemeSwitcher.test.tsx) | 15 | Retain rejected/pending preference changes, activity uninstall feedback, bounded text-size and transparency choices. |
| [Titlebar.test.tsx](../tests/component/Titlebar.test.tsx) | 6 | Retain platform traffic lights, controlled first-frame loading, settings focus return and outside-pointer dismissal. |
| [UpdateBanner.test.tsx](../tests/component/UpdateBanner.test.tsx) | 9 | Retain check/download/install states, stale-result protection, fake-clock dismissal, progress and fixed releases fallback. |
| [useEditorDocuments.test.tsx](../tests/component/useEditorDocuments.test.tsx) | 8 | Retain document/diff identity, in-flight load/save invalidation, conflict consent, queued latest edits and unmount write cancellation. |
| [useSettingsPersistence.test.tsx](../tests/component/useSettingsPersistence.test.tsx) | 2 | Keep newest-draft merge and in-flight serialized retry with controlled promises. |
| [VerticalTabBar.test.tsx](../tests/component/VerticalTabBar.test.tsx) | 30 | Retain parent-specific creation, independent launcher choices, worktree/Library ownership, draft recovery, keyboard menus, viewport containment and accessible status. |
| [WorkspaceContent.test.tsx](../tests/component/WorkspaceContent.test.tsx) | 9 | Retain roving document tabs, unsaved announcements, read-only diff surface, exact document-key callbacks and loading/error/save states. |

### Electron

| File | Definitions | Disposition |
| --- | ---: | --- |
| [agent-integrations.spec.ts](../tests/e2e/agent-integrations.spec.ts) | 1 | Retain bundled-helper uninstall with disposable agent homes, preserved unrelated configuration/backups and persisted toggle. Share native environment setup. |
| [broadcast-input.spec.ts](../tests/e2e/broadcast-input.spec.ts) | 1 | Retain real simultaneous recipients, exact per-process file results, confirmation geometry and Escape cancellation. Share environment setup. |
| [close-shutdown.spec.ts](../tests/e2e/close-shutdown.spec.ts) | 2 | Retain owned-process shutdown and same-window dirty-close cancellation. Resolve the canceled fixture with explicit discard before profile cleanup; share environment setup. |
| [command-history.spec.ts](../tests/e2e/command-history.spec.ts) | 1 | Retain real running/completed metadata, deduplication, output privacy, keyboard selection, no-submit and explicit re-execution. Share environment setup. |
| [cwd-tracking.spec.ts](../tests/e2e/cwd-tracking.spec.ts) | 1 | Retain actual shell-to-Explorer traversal through URL-special/Unicode paths and preload hostname validation. Share environment setup. |
| [design-captures.spec.ts](../tests/e2e/design-captures.spec.ts) | 1 | Retain opt-in developer review generator and style-diff support. Require exactly one maximized pane and fail after collecting capture gaps instead of reporting warning-only success; share environment setup. |
| [dev-instance.spec.ts](../tests/e2e/dev-instance.spec.ts) | 1 | Retain real dev-launcher/server/CDP startup and owned process-tree cleanup. Its raw launcher is intentional coverage separate from packaged-origin app launches. |
| [editor.spec.ts](../tests/e2e/editor.spec.ts) | 3 | Retain real Monaco workers, edits/conflicts/discard, font resizing and zero-terminal project restart; share environment setup. |
| [final-visual-matrix.spec.ts](../tests/e2e/final-visual-matrix.spec.ts) | 1 | Retain all themes and both viewport sizes with real agent/failure/broadcast fixtures, measured contrast/geometry and captured errors. Share environment setup. |
| [focus-notifications.spec.ts](../tests/e2e/focus-notifications.spec.ts) | 1 | Retain focus-dependent decisions and real hook/helper PTY lifecycle, unread acknowledgement and strict privacy fields. The 10.5 s command crosses the product threshold intentionally; share environment setup. |
| [hermes-copy.spec.ts](../tests/e2e/hermes-copy.spec.ts) | 1 | Retain installed-Hermes opt-in native modifier selection/redraw coverage; synthetic TUI coverage does not replace this external integration. |
| [local-terminal-recovery.spec.ts](../tests/e2e/local-terminal-recovery.spec.ts) | 1 | Retain missing-shell environment and explicit retry in the same pane. Short negative-observation dwell checks absence of automatic recovery, not readiness. |
| [motion.spec.ts](../tests/e2e/motion.spec.ts) | 1 | Use a startup raw PTY reader and its parsed readiness marker to prove all four input bytes during exit animation; retain both motion modes, focus, exact resize counts and session identity. |
| [notification-activation.spec.ts](../tests/e2e/notification-activation.spec.ts) | 1 | Use bounded shared shutdown and delete only the random test-owned protocol registration outside CDP, preserving the primary failure. Windows-only protocol coverage remains explicit. |
| [optional-workspace-setup.spec.ts](../tests/e2e/optional-workspace-setup.spec.ts) | 2 | Retain skip/setup persistence across restart and immediate-folder import without touching nested folders or files. |
| [pane-maximize.spec.ts](../tests/e2e/pane-maximize.spec.ts) | 9 | Replace bespoke spawn/port/CDP/kill harness with shared native lifecycle and owned afterEach cleanup. Remove redundant fake-browser cleanup case covered by lifecycle units; retain all nine real pane scenarios. |
| [performance-baseline.spec.ts](../tests/e2e/performance-baseline.spec.ts) | 1 | Retain measured startup, input under sustained output and five pane-lifecycle memory samples. These are attached baselines, not invented cross-machine limits; use shared shutdown. |
| [public-screenshots.spec.ts](../tests/e2e/public-screenshots.spec.ts) | 1 | Retain Windows opt-in generator, synthetic ownership/privacy, exact asset pairs and stable opaque frames. Refreshed and visually reviewed changed One Dark images; share environment setup. |
| [rename-workspace.spec.ts](../tests/e2e/rename-workspace.spec.ts) | 1 | Wait for parsed shell readiness and use assembled output markers absent from typed commands, proving execution after focus handoff. Retain rename/cancel/restart checks; share environment setup. |
| [semantic-command.spec.ts](../tests/e2e/semantic-command.spec.ts) | 1 | Retain real command/output copy, decoration geometry, no-submit and explicit execution. The short negative-observation dwell protects the no-submit assertion; share environment setup. |
| [settings-recovery.spec.ts](../tests/e2e/settings-recovery.spec.ts) | 3 | Retain remote-to-local safety migration, byte-preserving corrupt-file recovery and explicit reset confirmation; share environment setup. |
| [snippets.spec.ts](../tests/e2e/snippets.spec.ts) | 1 | Retain native compact picker geometry and mouse confirmation/delete regression; share environment setup. |
| [terminal-copy.spec.ts](../tests/e2e/terminal-copy.spec.ts) | 5 | Retain native selection/copy/paste and synthetic mouse-mode/redraw/OSC8/OSC52/bracketed/image boundaries. Each exercises a distinct protocol or gesture; share environment setup. |
| [terminal-graphics.spec.ts](../tests/e2e/terminal-graphics.spec.ts) | 1 | Retain real PTY query/reply, raw and PNG chunked transfers, rendered pixels and deletion; pure addon guards cannot replace it. |
| [terminal-path-drag.spec.ts](../tests/e2e/terminal-path-drag.spec.ts) | 1 | Enable Windows with PowerShell-specific quoting/existence proof and parsed readiness. Retain real Explorer/Source Control clipboard/drop paths and no implicit Enter; share environment setup. |
| [theme-contrast.spec.ts](../tests/e2e/theme-contrast.spec.ts) | 1 | Retain computed glass text across every theme and system/reduced transparency with modeled OS/material backdrops; complements selected-control visual matrix. |
| [transparency.spec.ts](../tests/e2e/transparency.spec.ts) | 1 | Retain platform-derived material expectations, three preferences, native scheme and first-frame persisted state after restart. |
| [version-update.spec.ts](../tests/e2e/version-update.spec.ts) | 3 | Retain current version action; run packaged diagnostics/failure fallback in Windows CI after packaging, with separate output. Other packaged platforms remain opt-in. Share environment setup. |
| [workspace-directories.spec.ts](../tests/e2e/workspace-directories.spec.ts) | 3 | Retain cross-restart folder ownership/import/promote/remove/recovery journey and separate real Git worktree cases. Filesystem side effects and saved sessions are asserted, not just rendered labels. |
| [workspace-groups.spec.ts](../tests/e2e/workspace-groups.spec.ts) | 1 | Retain real grouped workspace creation, collapsed group persistence and independent terminal restoration with no save action; use shared shutdown. |
| [workspace-layout.spec.ts](../tests/e2e/workspace-layout.spec.ts) | 3 | Wait for parsed shell readiness before the Python harness. Retain measured native compact targets, desktop/narrow region ownership, keyboard menus and real Hermes lifecycle; share environment setup. |
| [workspace-tools.spec.ts](../tests/e2e/workspace-tools.spec.ts) | 2 | Retain selected-pane cwd/file context, breadcrumb keyboard behavior and both-side native scrolling with a stationary footer; use shared shutdown. |
