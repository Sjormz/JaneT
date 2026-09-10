# Workspace UI rework

## Final behavior ? 2026-09-08

- Workspaces and Library have matching section headers and separate plus buttons. Workspaces adds a workspace; Library links a parent directory. Each expanded parent always offers Add project.
- Create project is an inline page for the clicked parent, with no parent selector or workspace/project switch. Workspace projects create a folder; Library projects reuse the linked directory without creating a folder. Add terminals optionally reveals startup controls.
- Library projects persist after closing their last terminal and across restart. Remove project removes only the saved project entry. Linked Git worktrees show a small `w` beneath the project name; the main checkout does not.
- Empty projects show Start session inline. A session is a group of terminals, not an additional persisted hierarchy. Existing sessions offer Add terminals from a single terminal-header plus.
- Terminal startup choices are Terminal, Codex, Hermes, Claude, and Custom. The count starts at one; Custom uses the code icon. Terminal opens the configured shell without a startup command.
- Adding terminals arranges all panes in reading order using the existing near-square layout algorithm. Existing terminal IDs survive; manual pane sizes reset on addition. Directional split shortcuts and command actions remain available.
- Parent/section terminal counts and inline row launch controls are gone. Project terminal counts remain. Library parents cannot be renamed; Library projects do not offer Keep in Library.
- Project tools uses the vertical tool rail, matching sidebar headers and bottom collapse actions. Adjacent panels on the left have square joining corners and one divider.
- Shared dialog headers have compact spacing. Workspace location has an inset path and aligned action. The landing page is inline, and number fields retain a restrained visible focus indicator.
- Settings says Project tools position. Notification delivery uses a fixed ten-second cutoff and a themed native checkbox. One Dark is the default and first theme; saved theme choices are preserved.

## Cleanup completed

- Removed hidden actions, parent counts, creation switches/menus, their unused callbacks/state, and prototype CSS overrides.
- Simplified the shared creation form to receive one parent directly, including Library child projects. The landing page follows the same flow.
- Removed directional button callbacks from SplitPane. Tests now exercise preserved split commands or the approved plus chooser.
- Removed notification threshold state and save-on-mount plumbing. Legacy stored threshold fields remain readable for profile compatibility but no longer control delivery.
- Kept SSH connection management reachable through its existing command, opening a dedicated dialog rather than resurrecting sidebar row actions.
- Fixed Library child-project deletion through the existing confirmation and Recycle Bin path. Parent Library deletion and Keep in Library remain blocked; containment, overlap, and protected-path checks remain in place.
- Kept batch addition working for existing standalone sessions as well as directory-backed projects.
- Updated component and Electron flow tests, including Library projects, restart persistence, optional terminals, and fixed notification timing.

## Verification

- TypeScript check and production build passed.
- Full Vitest suite: 1,262 passed, eight existing skips, no failures. Git and Python prerequisites were supplied from temporary official runtime archives; no system installation was changed.
- Eight targeted Electron checks passed: optional setup, grouped projects, Library child projects and file preservation, restart persistence, broadcast input through split shortcuts, compact target geometry, sidebar layout, notification timing, and Hermes lifecycle coverage across the selected tests.
- Inspected the generated creation-page screenshot. Git whitespace check passed.
- The running dev profile and its terminals were left open. Test profiles and runtime tools were isolated from user data.

The complete Electron suite, including the optional local SSH-server integration, was not run. The migrated split shortcut was exercised by the real-PTY broadcast test.

## Separate follow-up

The reported Codex block-background difference in Solarized Light was not reproduced or attributed to a confirmed cause. No speculative ANSI palette change was made as part of this cleanup.
