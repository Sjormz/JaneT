# Workspace tools audit — 5 September 2026

## Verdict and scope

The basic architecture is appropriate, but this section is **not yet consistently correct across shells, operating systems and failure states**. Retain the existing shell integration and refresh coordinator; repair their boundary cases rather than replacing them with prompt scraping or repeated injected `pwd` commands.

This review covered the tools shell/docking, focused-pane selection, local and remote Explorer, navigation, hidden files, refresh/cache behavior, path copying/dragging, editor/diff entry points, Source Control status, branches, worktrees, mutations, and their preload/main-process calls. It is a source-and-focused-test audit, not a certification or a full native platform matrix. Existing uncommitted Library work was preserved.

Implemented in this pass: removed the redundant Following/terminal/path block, removed its dead props/styles, and put Explorer breadcrumbs behind the labelled **Browse parent folders** disclosure. Folder navigation remains available because browsing in Explorer does not change the shell's directory. The footer remains the local terminal location display. No functional findings below were silently implemented. No running user app was restarted.

## How directory tracking actually works

1. `TerminalManager.create` chooses a shell and starting directory, installs a shell-specific prompt hook, and launches a PTY.
2. `buildShellInit` emits OSC 7 containing a `file://host/path` value at prompts for PowerShell, Bash, Zsh and Fish.
3. `TerminalPane` registers xterm's OSC parser **only for local panes**. `fileUrlToPath` decodes the payload; changes are debounced 80 ms.
4. `App.handleCwdChange` keeps a per-terminal map. The focused pane's entry drives Explorer, local Git discovery and the footer; the latest values also enter saved pane state.
5. Until a report arrives, the UI uses the pane/project starting directory, then main directory/home. That fallback is not distinguished from a confirmed current location.
6. SSH Explorer uses a separate SFTP connection, initially resolving `.`. It does not consume remote shell cwd reports. The remote footer explicitly says working directory is unavailable in its accessible description.

OSC means Operating System Command, but it is a **terminal escape convention**, not an OS API that Windows/macOS/Linux automatically emit. The shell must cooperate. OSC 7 is established and suitable here; it is not the only dialect. [WezTerm shell integration](https://wezterm.org/shell-integration.html) documents it. [Windows Terminal](https://learn.microsoft.com/en-us/windows/terminal/tutorials/new-tab-same-directory) documents OSC 9;9, including cmd PROMPT and WSL path conversion. [VS Code](https://code.visualstudio.com/docs/terminal/shell-integration) documents additional 633 and 1337 cwd sequences. Supporting all dialects is optional; advertising accurate coverage and handling the chosen dialect correctly is not.

## Prioritized findings

### 1. High: local/remote namespace is discarded in cwd reports

Evidence: `src/renderer/osc7.ts:fileUrlToPath` drops everything before the first path slash; `TerminalPane.tsx` accepts any OSC 7 arriving in a local PTY. A direct decoder probe returned `/home/alice` for `file://remote.example/home/alice`. A nested SSH shell can therefore redirect local Explorer/Git to an unrelated local path. Similarly, `file://server/share/folder` becomes `/share/folder`, not a Windows network share. This establishes a routing defect, not a demonstrated arbitrary-code exploit.

Fix: retain origin/authority and path flavor; accept a local report only when its namespace can be resolved as local. Handle UNC shares explicitly and treat unknown remote/container/WSL origins as unavailable rather than guessing. Do not blindly convert every hostname into a network access. File URI authority has defined meaning in [RFC 8089](https://www.rfc-editor.org/rfc/rfc8089.html).

Acceptance: local hostname/FQDN aliases, localhost, UNC shares, nested SSH, containers, WSL, and malicious/malformed reports cannot silently select another filesystem.

### 2. High: raw emission and percent decoding disagree

Evidence: `shell-init.ts` emits raw `$PWD`/`ProviderPath`; `osc7.ts` always calls `decodeURIComponent`. Direct probes on the actual helper:

| Payload suffix | Actual result |
| --- | --- |
| `C:/work/100%done` | `null` — previous directory remains |
| `C:/work/literal%20name` | `C:/work/literal name` — wrong directory |
| `C:/bad%00name` | A path containing NUL is accepted |

Raw control characters in valid Unix filenames can also terminate a raw OSC sequence. Spaces happen to work in this permissive parser, but that does not solve URI round-tripping.

Fix: percent-encode UTF-8 path data in every supported emitter and decode exactly once; validate the complete payload, length, absolute-path shape, decoded controls/NUL and authority before publishing a cwd. Do not make malformed `%` silently literal: that would preserve ambiguity with correctly encoded external reports. [RFC 8089 encoding guidance](https://www.rfc-editor.org/rfc/rfc8089.html#section-4) provides the URI baseline.

Acceptance: round-trip spaces, literal `%20`, `%`, `#`, Unicode and apostrophes; reject controls and malformed reports without changing the last valid location.

### 3. High: Git failures can look like current status

Evidence: `src/main/git.ts:status/details/findRepo` collapse failures into null/empty outcomes. `useGitRepository.ts` retains previous status when a read fails or returns null and exposes no error/staleness field. A prior clean/dirty snapshot can remain on screen indefinitely while Git is unavailable. Initial failures show an incomplete panel or no repository rather than the actual cause. Most mutations return only `false`, losing permission, identity, authentication, conflict and safe-directory explanations.

Fix: return bounded structured errors; distinguish loading, unavailable, stale and not-a-repository; disable destructive actions when the repository snapshot is uncertain; offer retry. Keep last-good data only when visibly marked stale. Add timeouts/abort handling for Git processes, especially credentials/hooks/network operations; the shared UI lock otherwise waits indefinitely.

Acceptance: remove Git from PATH, deny repository access, fail status after success, reject authentication and stall a subprocess. The panel must not say clean or silently stay busy.

### 4. Medium: platform/shell coverage is incomplete and fallback looks authoritative

Evidence: `shell-init.ts` returns no integration for cmd and other unsupported shells; `terminal.ts:shellLaunch` has no WSL/MSYS namespace mapping or native cwd fallback. The source comment claiming cmd cannot report its directory is too strong: documented PROMPT escape integration exists. PowerShell emits `ProviderPath` without checking FileSystem, so Registry/Env locations can be misrepresented as directories. The PowerShell emitter assumes COMPUTERNAME and adds a slash, which also needs review for PowerShell on Unix. Git Bash may report `/c/...`, which Windows filesystem APIs do not interpret as `C:/...`.

Fix: explicitly model `starting`, `reported`, `unavailable` and source/platform; gate PowerShell on its FileSystem provider; support cmd through its documented prompt capability or clearly mark it unsupported. Add WSL/Git Bash mapping only with an identified environment. Preserve custom ZDOTDIR: the current Zsh launcher overrides it and then sources only `~/.zshrc`.

Acceptance: test Windows PowerShell 5.1/7, Bash, Zsh, Fish, cmd, customized profiles, PowerShell non-filesystem providers, Git Bash and WSL. Check [PowerShell provider semantics](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_providers).

### 5. Medium: SSH Explorer does not follow remote `cd`

Evidence: `FileExplorerSource` has no remote cwd, `TerminalPane` only installs OSC 7 for local tabs, and `SSHManager.listDir` resolves SFTP `.` independently. Different SSH panes have separate navigation keys but do not start from each pane's shell directory. This is an intentional implementation boundary, but differs from the requested terminal-follow model.

Fix: track authenticated remote cwd per pane; use it only with the corresponding connection identity and SFTP namespace. A chrooted SFTP server may not share shell paths, so expose that limitation instead of falling back to local files. Leave remote Source Control explicitly unavailable until implemented.

### 6. Medium: UNC and lowercase-drive breadcrumb targets are incorrect

Evidence: `FileExplorer.tsx:pathSegments` splits on separators and rebuilds ancestors without retaining a UNC root. `\\server\share\folder` ancestors become relative `server\share` paths; the slash form loses one leading slash. The drive button's uppercase-only match hides a lowercase drive even though the segment is later filtered case-insensitively. These remain defects when the new location disclosure is opened.

Fix: use a root-aware path-segment helper (POSIX, drive, UNC), separate display labels from absolute target paths, and never let an ancestor action submit a relative path. Test drive roots, share roots, trailing separators and Unicode.

### 7. Medium: Source Control can remove worktrees that JaneT still uses

Evidence: `GitTree` knows `openLocalTerminals`, but `handleRemoveWorktree` does not use them to block/warn; `GitManager.removeWorktree` delegates directly to Git and has no session/editor/Library coordination. Git normally refuses dirty worktrees unless force is explicitly entered, but does not guarantee protection for open terminals/editors. On Unix an open cwd need not prevent removal; Windows handles may instead cause failure.

Fix: revalidate active terminal/editor ownership at confirmation, identify the full target path and affected sessions, and reconcile saved workspace/Library entries after success. This is separate from the correct non-destructive **Remove from Library** action. Do not change Git discard semantics implicitly: current untracked deletion is permanent and the dialog correctly warns of that.

### 8. Medium: Git command and IPC validation is uneven

Evidence: main IPC checks the sender/frame, but many handlers destructure unchecked payloads. `fsListDir` resolves relative paths against the app process cwd. Git branch/worktree operations call `.trim()` without complete runtime shape validation and pass user input as argv without uniformly rejecting leading options. `git switch` can interpret a user-entered option as an option; this is argument ambiguity, not shell-string injection. File stage/discard already use `--literal-pathspecs` and `--`, which is good.

Fix: validate absolute repo/directory paths, request shapes/lengths and actual booleans at the main boundary; validate branch names with Git's own rules; reject option-shaped user values and use end-of-options where the specific command supports it. Keep renderer validation as convenience, not the security boundary.

### 9. Medium: drafts/navigation can disappear when tools are switched

Evidence: `Sidebar` conditionally unmounts Explorer/GitTree when switching or collapsing. Commit text, worktree dialog drafts, hidden-file preference and Explorer navigation live inside those components. Conversely, `GitTree` does not reset/scope `commitMessage` when repoPath changes, so a message drafted for repository A can appear in B. Worktree defaults report no save error (`setSettings(...).catch(() => {})`); an invalid branch/worktree submission closes the dialog before asynchronous validation succeeds. The worktree path suggestion fills on the first nonempty branch character and stops following later edits.

Fix: retain lightweight view state per repository/source outside the mount boundary, without keeping hidden polling alive. Preserve drafts on failed submit, show inline errors, and scope commit messages by repository. Only update an auto-suggested path while it remains unedited.

### 10. Lower: large-folder and interaction polish gaps

Evidence: Explorer reads are bounded, but all rows render at once; the per-source navigation map/history is unbounded while mounted. Local hidden-file filtering checks only a leading dot, not Windows Hidden/System attributes. Git worktree overflow actions lack the menu keyboard/expanded-state behavior used by the Git file context menu. Copy-path quoting uses the saved startup dialect or path-shape inference, not the shell currently running; cmd and nested shells can receive inappropriate quoting. Git discovery checks for `.git` rather than asking Git, so bare repos, invalid `.git` markers and discovery/environment nuances are not represented accurately.

Fix: clarify dotfile semantics or support native hidden attributes; bound navigation retention and virtualize only after measuring large lists; reuse existing accessible menu behavior; carry known shell dialect and report unsupported quoting. Prefer Git's `rev-parse --show-toplevel` plus explicit bare-repository handling for authoritative discovery. [Git rev-parse](https://git-scm.com/docs/git-rev-parse) defines those queries.

## What is already sound

- Footer and local tools share `effectiveCwd`; focused-pane behavior passed the isolated Electron check.
- xterm's public OSC parser is used instead of parsing printed prompts or hand-assembling stream chunks. [xterm parser API](https://xtermjs.org/docs/api/terminal/interfaces/iparser/).
- Explorer tracks request generations/source identity and hides old entries while navigation fails or a source changes. SSH listings retain connection identity and do not fall back to local files.
- One refresh coordinator deduplicates work, pauses background refresh while hidden/unfocused, and coalesces invalidations. Explorer polls at 5 s, Git status 3 s, discovery 15 s and details 10 s; prompt events invalidate reads. Prompt invalidation is global, so many noisy panes deserve a future scoped/coalesced stress test.
- Filesystem snapshots are bounded to 32 directories, entries to 10,000, and metadata concurrency to 32. Watcher failure falls back to metadata refresh. SSH operations have a timeout and entry/path bounds.
- Git status and worktrees use NUL-delimited machine output; file mutation pathspecs are literal. Pull is fast-forward-only, push is not force, branch/worktree force needs explicit input. [Git status porcelain](https://git-scm.com/docs/git-status#_porcelain_format_version_1).
- Text/diff opening is bounded to 2 MiB and checks path identity/revisions; path drag/drop carries local/SSH ownership and rejects control characters. This audit checked these entry boundaries, not every editor feature.
- Tool tabs have keyboard navigation, labels, selected/expanded state; destructive dialogs focus Cancel. Existing themes/icons/focus behavior were reused for this cleanup.

## Recommended implementation order

1. **Reliable cwd contract:** origin + encoding + provider/path validation + honest fallback. Resolve the decoder defects before adding more OSC dialects.
2. **Honest Git state and safe actions:** error propagation/timeouts, native input validation, worktree ownership checks.
3. **Explorer and state polish:** root-correct breadcrumbs, remote cwd, durable per-source drafts/navigation, menu behavior and hidden-file semantics.
4. **Platform acceptance:** real macOS/Linux shells, cmd/Git Bash/WSL, remote SFTP/chroot, network shares and large repositories. Do not treat mocked cross-platform paths as native OS validation.

## Verification and limitations

- TypeScript check and production build passed; build retains the existing large-chunk warning.
- Focused unit/component checks cover tools, Git, filesystem refresh, quoting, parser and shell integration: **174 passed, zero failed, two skipped**, recorded in `test-results/workspace-tools-final.json`.
- Dedicated Electron test passed two-pane focus/Explorer/footer synchronization, compact default UI and expandable navigation; reviewed `workspace-tools-compact.png` in Tokyo Night on Windows.
- Shell tests exercised available Windows PowerShell and Bash paths; the real Bash-array-hook and real Zsh cases were skipped by platform/availability gates. No native macOS/Linux GUI, Windows network-share, live WSL, external SSH or interactive credential test was performed.
- The existing all-theme Electron suite stopped before its matrix on its obsolete `.vtab-sub` expectation for the previously removed SSH subtitle. This is not a passing all-theme run. Full SplitPane tests also have previously recorded starter-session fixture debt; this pass updated only the removed following-target assertion contract.
- No user files were deleted, no external Git remote was changed, and the live dev app was not restarted. Git tests used disposable repositories, including a local bare remote.
