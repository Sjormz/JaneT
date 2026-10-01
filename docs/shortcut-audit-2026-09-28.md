# Keyboard shortcut audit — 28 September 2026

Internal review of every key JaneT intercepts before a terminal program sees it. It covers the app shortcuts (`src/shared/keybindings.ts`) and the xterm-level keys in `TerminalPane.attachCustomKeyEventHandler`, the capture-phase handler in `KeybindingsContext`, and Monaco. It checks them against shell line editing, terminal programs, OS and window-manager keys, AltGr layouts, and other terminals' conventions. The user guide is `docs/site/reference/shortcuts.md`.

## How JaneT sees keys

- `KeybindingsContext` listens for `keydown` on `document` in the **capture phase**. An app shortcut that matches is consumed before xterm.js or Monaco sees it, in every terminal and in the editor. Anything bound there is lost to every shell and TUI.
- `TerminalPane` then handles copy, paste, search, and semantic-command keys inside xterm's custom key handler. Semantic keys pass through when no command is selected. After this change they also pass through on the alternate screen.
- xterm.js 6 (`common/input/Keyboard.ts`) encodes keys as follows:
  - `Ctrl+letter` sends C0 control characters.
  - `Ctrl+3…7`, `Ctrl+8`, `Ctrl+/`, `Ctrl+[`, `Ctrl+\`, `Ctrl+]` and `Ctrl+Space` send control characters.
  - `Ctrl+Shift+letter`, `Ctrl+,`, `Ctrl+=`, `Ctrl+-`, `Ctrl+0` and `Ctrl+Shift+5`/`'` send **nothing**.
  - Of the Ctrl+Shift keys, only `Ctrl+Shift+-` (`^_`), `Ctrl+Shift+2` (`^@`) and `Ctrl+Shift+6` (`^^`) send bytes.
  - `Alt+key` sends ESC-prefixed Meta. `Ctrl+Alt+letter` sends ESC + control character.
  - Function and arrow keys send CSI sequences with modifier parameters.
  - JaneT's xterm has no kitty keyboard protocol or modifyOtherKeys, so programs cannot tell `Ctrl+Shift+X` from nothing.
- Electron's application menu is removed (`Menu.setApplicationMenu(null)`). No accelerators are registered, including DevTools `Ctrl+Shift+I`/`F12` and reload `Ctrl+R`. `openDevTools` is only called in `NODE_ENV=development`. The rename-workspace e2e test asserts that `Ctrl+Shift+I` does not open DevTools.

## Bug A: Shift+punctuation never matched

Before the fix, `matchesShortcut` compared `KeyboardEvent.key`:

- With Shift held, US-style layouts report `|` for the `\` key, so `Ctrl+Shift+\` / `Cmd+Shift+\` ("Split pane below") never fired.
- `Ctrl+Plus` only matched an unshifted `=` key. It failed with numpad `+`, with `Ctrl+Shift+=`, and on layouts with their own `+` key, such as German.
- Letter shortcuts failed on non-Latin layouts (Cyrillic `А` for `F`).
- Mac Option combinations reported `ç` and similar characters, so they failed too.

Now `shortcutKeyFromEvent` normalizes the key:

- **Shift+punctuation:** when `key` is the US-shifted glyph of the physical `code`, the unshifted key is used.
- **Non-ASCII key:** the physical key is used, except for Ctrl+Alt without Meta (AltGr). Latin letters are never remapped, so Dvorak `Ctrl+U` stays the shell's kill-line.
- **Plus:** matches `=` or any `+`, regardless of Shift.

`formatShortcut` records the same normalized key, so a captured chord fires again. Unit tests dispatch real `key`+`code` pairs for each case.

## Audit table

Legend for conflicts:

- **RL** readline (bash, emacs mode)
- **ZLE** zsh
- **PSR** PowerShell PSReadLine
- **TMUX** tmux / screen
- **TUI** vim, emacs, nano, less, htop, mc, fzf, Claude Code, Codex, lazygit
- **OS** Windows, GNOME, KDE or macOS reserved keys
- **AltGr** European layouts where Ctrl+Alt = AltGr
- **Monaco** the embedded editor's own keys

| Action | Old Win/Linux | Old macOS | Conflicts found | New Win/Linux | New macOS | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| Search terminal output | `Ctrl+F` | `Cmd+F` | Win/Linux: RL/ZLE forward-char, emacs forward-char, less/vim page forward, fzf, nano Ctrl+F (forward), tmux users' prefix. Mac: none (Cmd never reaches programs). | `Ctrl+Shift+F` | `Cmd+F` | Windows Terminal, GNOME Terminal, WezTerm and kitty use Ctrl+Shift+F. Microsoft Pinyin IME uses Ctrl+Shift+F for its simplified/traditional toggle; noted, same as Windows Terminal. |
| Open command palette | `Ctrl+Shift+P` | `Cmd+Shift+P` | None at the PTY level. VS Code convention. | `Ctrl+Shift+P` | `Cmd+Shift+P` | Unchanged. Windows Terminal and WezTerm use the same key. |
| New terminal tab | `Ctrl+Shift+T` | `Cmd+T` | None at the PTY level. | `Ctrl+Shift+T` | `Cmd+T` | Unchanged. Windows Terminal, GNOME Terminal and kitty convention. |
| Close current terminal | `Ctrl+W` | `Cmd+W` | Win/Linux: RL/ZLE/PSR unix-word-rubout (delete word; the most common one, which opened "Close pane?"), vim window prefix, emacs kill-region, nano where-is, Claude Code/Codex delete-word. | `Ctrl+Shift+W` | `Cmd+W` | Windows Terminal/GNOME Terminal close convention. |
| Close current pane | `Ctrl+Shift+W` | `Cmd+Shift+W` | Win/Linux: none at the PTY level, but it would duplicate the new close-terminal key. | Unassigned | `Cmd+Shift+W` | "Close current terminal" already closes the focused pane (or the tab if it is the last pane), and the two actions differ only for a one-pane tab. Users can still assign it. |
| Open settings | `Ctrl+,` | `Cmd+,` | Ctrl+, sends nothing in xterm.js. Emacs `C-,` cannot be typed in a legacy terminal. | `Ctrl+,` | `Cmd+,` | Unchanged. Windows Terminal, VS Code and macOS convention. |
| Show or hide workspace tools | `Ctrl+B` | `Cmd+B` | Win/Linux: tmux default prefix, RL/ZLE backward-char, vim page back, emacs backward-char, less back, nano back. | `Ctrl+Shift+B` | `Cmd+B` | Sends nothing at the PTY level. Monaco has no standalone Ctrl+Shift+B. |
| Increase terminal text size | `Ctrl+Plus` | `Cmd+Plus` | Sends nothing in xterm.js; it did not work with numpad or on German layouts (bug A). | `Ctrl+Plus` | `Cmd+Plus` | Unchanged chord, fixed matching. Windows Terminal, GNOME Terminal, VS Code and WezTerm use Ctrl+=/-/0. |
| Decrease terminal text size | `Ctrl+-` | `Cmd+-` | xterm.js sends nothing for unshifted Ctrl+-. Readline/emacs undo (`Ctrl+_`) is Ctrl+**Shift**+-, which does not match. | `Ctrl+-` | `Cmd+-` | Unchanged; convention. |
| Reset terminal text size | `Ctrl+0` | `Cmd+0` | xterm.js sends nothing. | `Ctrl+0` | `Cmd+0` | Unchanged; convention. |
| Previous / next terminal tab | `Ctrl+Shift+Tab` / `Ctrl+Tab` | same | xterm.js sends Tab / Back-Tab, so programs cannot tell these apart from Tab without kitty/CSI-u. GNOME Terminal uses Ctrl+PageUp/Down instead, but those send CSI 5;5~ which vim/nano/emacs use. The macOS Ctrl+Tab app switcher applies only with Cmd. | `Ctrl+Shift+Tab` / `Ctrl+Tab` | `Ctrl+Shift+Tab` / `Ctrl+Tab` | Unchanged. Windows Terminal, VS Code, iTerm2 and Terminal.app all accept Ctrl+Tab. |
| Split pane right | `Ctrl+\` | `Cmd+\` | Win/Linux: `Ctrl+\` is SIGQUIT (quit with a core dump; used to kill hung programs) and emacs `C-\` toggle-input-method. | `Ctrl+Shift+5` | `Cmd+\` | VS Code's terminal split key, and tmux's `%` split. Sends nothing in xterm.js. |
| Split pane below | `Ctrl+Shift+\` | `Cmd+Shift+\` | **Never fired** (bug A). Mac: Monaco jump-to-bracket, only while the editor is focused. | `Ctrl+Shift+'` | `Cmd+Shift+\` | tmux `"` split. Sends nothing. Considered and rejected: `Ctrl+Shift+-` (sends `^_` undo in RL/emacs, nano go-to-line) and Windows Terminal's `Alt+Shift+-`/`Plus` (Alt = Meta; `M-_` is bash yank-last-arg). |
| Rename current terminal | `F2` | `F2` | All platforms: htop Setup, mc user menu, byobu new window, many TUI function-key menus. The macOS F2 hardware key needs fn. | `Ctrl+Shift+F2` | `Cmd+Shift+F2` | Keeps the F2 = rename mnemonic from VS Code and Explorer. byobu uses Ctrl+Shift+F2 for a new session; rare, documented here. |
| Rename current tab | `Ctrl+F2` | `Cmd+F2` | Win/Linux: KDE Plasma switch to desktop 2 (Ctrl+F1–F4); byobu Ctrl+F2 vertical split; programs receive CSI 1;5Q. | `Ctrl+Shift+I` | `Cmd+F2` | Terminal.app uses ⇧⌘I for Edit Title. Sends nothing in xterm.js. It would be Chromium's DevTools chord, but JaneT registers no accelerator for it; checked in source and e2e. |
| Previous / next semantic command | `Ctrl+Shift+ArrowUp/Down` | same | Win/Linux: TUIs can read CSI 1;6A/B (micro, some editors). GNOME Terminal, kitty and Windows Terminal scroll by a line with these keys. Mac: Ctrl+arrow keys are Mission Control / App Exposé territory. | `Ctrl+Shift+ArrowUp/Down` | `Cmd+ArrowUp/Down` | Win/Linux unchanged, but now inactive on the alternate screen, so full-screen TUIs get the key. The handler already passes through when there are no marks. macOS follows VS Code's terminal (Cmd+Up/Down scroll to previous/next command). |
| Copy semantic command | `Ctrl+Alt+C` | `Ctrl+Alt+C` | Win/Linux: AltGr+C types `ć` (Polish), `©` and similar; emacs `C-M-c` exit-recursive-edit. Mac: Ctrl+Option is the VoiceOver modifier. | `Ctrl+Shift+K` | `Cmd+Option+C` | `Ctrl+Shift+C` is terminal copy. Sends nothing at the PTY level. Cmd+Option+C is not reserved by macOS. |
| Copy semantic command output | `Ctrl+Alt+O` | `Ctrl+Alt+O` | AltGr+O types `ó`, `ø` or `œ`; emacs `C-M-o` split-line. Mac: VoiceOver. | `Ctrl+Shift+O` | `Cmd+Option+O` | O for output. Monaco's Ctrl+Shift+O does not apply, because this key is only handled inside a terminal. |
| Paste semantic command for rerun | `Ctrl+Alt+R` | `Ctrl+Alt+R` | AltGr+R types `¶` or `®`; emacs `C-M-r` regexp isearch backward. Mac: VoiceOver. | `Ctrl+Shift+R` | `Cmd+Option+R` | R for rerun. Electron's reload chord is not registered (no menu). |
| Snippets, command history, maximize, focus next/previous pane, move pane ×4, save/close document | Unassigned | Unassigned | — | Unassigned | Unassigned | Unchanged; available in the command palette. |

## Terminal-level keys (TerminalPane)

| Key | Old behavior | Conflicts found | New behavior | Rationale |
| --- | --- | --- | --- | --- |
| Paste | `Ctrl+V`, `Ctrl+Shift+V`, `Cmd+V`, `Shift+Insert` on every platform | **macOS:** plain Ctrl+V was paste, which broke vim visual-block (`^V`), RL/ZLE quoted-insert and emacs scroll. Linux: same conflict; GNOME Terminal, Konsole and kitty do not paste on Ctrl+V. | Windows: `Ctrl+V`, `Ctrl+Shift+V`, `Shift+Insert`. Linux: `Ctrl+Shift+V`, `Shift+Insert`. macOS: `Cmd+V` (and `Shift+Insert`). | Windows Terminal, conhost and PSReadLine paste on Ctrl+V. Vim-on-Windows users use Ctrl+Q for block selection there. |
| Copy | `Ctrl+C`/`Ctrl+Shift+C`/`Cmd+C` copy when there is a selection, otherwise pass through | **macOS:** Ctrl+C with a stale selection copied instead of interrupting. | Windows and Linux: `Ctrl+Shift+C`, or `Ctrl+C` while text is selected. macOS: `Cmd+C`; Ctrl+C always interrupts. Every Ctrl/Cmd+C still counts as a copy gesture for OSC 52 authorization. | Windows Terminal and VS Code copy on Ctrl+C with a selection, on both Windows and Linux. GNOME Terminal never does. Kept on Linux because the selection is visible and clears on typing, and existing e2e coverage and user habit rely on it. |
| Search | App binding | see table | App binding (`Ctrl+Shift+F` / `Cmd+F`) | — |
| Escape while search is open | Closes search | Only while the overlay is open. | Unchanged | — |
| Right-click | Copy selection, otherwise paste; mouse-tracking TUIs keep their own gesture | — | Unchanged | Windows Terminal / PuTTY convention. |

The global handler's exemption of Ctrl/Cmd+C/V inside `.terminal-container` now uses the normalized key, so it also holds on Cyrillic and other non-Latin layouts.

## Monaco editor

- Monaco binds `CtrlCmd+S` itself (save). Its other built-ins (Ctrl+F find, Ctrl+H replace, Ctrl+D, Ctrl+Shift+K, Ctrl+Shift+L, Ctrl+Shift+\\, F1 and so on) are only preempted when the same chord is an **app** binding, because the capture-phase handler runs first.
- New Win/Linux app chords that overlap Monaco: none. Ctrl+Shift+O, K and R are terminal-only.
- On macOS, `Cmd+Shift+\` (split below) preempts Monaco jump-to-bracket and `Cmd+B` has no Monaco meaning. Not changed; noted as a known minor conflict.
- Out of scope, possible follow-up: skip app shortcuts that Monaco also defines while the editor has focus.

## OS and window-manager reserved keys checked

- **Windows:** Win+* (Meta is never a default), Alt+Tab, Alt+F4, Ctrl+Esc, Ctrl+Shift+Esc, Ctrl+Alt+Del. Ctrl+Shift switches the IME/layout only when pressed alone. Intel graphics hotkeys use Ctrl+Alt+arrows. None are defaults.
- **GNOME/KDE:**
  - Super+*, Alt+F1/F2 (KRunner), Ctrl+Alt+arrows (workspaces), Ctrl+Alt+T, Ctrl+Alt+F1–F12 (VT switch).
  - KDE Ctrl+F1–F4, which ruled out Ctrl+F2.
  - IBus Ctrl+Shift+U (Unicode entry), Ctrl+Shift+E (emoji), Ctrl+Space and Ctrl+. / Ctrl+; (emoji). JaneT defaults avoid E, U, Space, `.` and `;`.
- **macOS:**
  - Cmd+Tab, Cmd+`, Cmd+Space, Cmd+H, Cmd+M, Cmd+Q, Cmd+Shift+3/4/5.
  - Ctrl+Space and Ctrl+arrows (input sources, Mission Control).
  - Ctrl+Option (VoiceOver).
  - With the application menu removed, Cmd+Q/H/M are not handled by JaneT itself. Pre-existing and out of scope.
- **AltGr:** Ctrl+Alt+printable key is never a Win/Linux default. `shortcutConflict` warns when a user assigns one, and the matcher never reads an AltGr character as a letter shortcut.

## Shortcut editor warnings

`shortcutConflict(shortcut, platform)` in `src/renderer/keybindings.ts` warns (it does not refuse) for:

- bare Ctrl+letter, naming the shell use;
- Ctrl+control-character keys;
- Ctrl+Alt+printable (AltGr);
- Alt+printable (Meta; macOS Option characters);
- bare F-keys;
- `Ctrl+Shift+-/2/6`;
- Win/Super chords and OS-reserved chords;
- the terminal copy/paste chords.

It also flags a chord already used by another action. Every shipped default passes this check on all three platforms (unit test).

## Migration

A per-platform migration runs once in `SettingsManager.parse()` (`migrateKeybindings` in `src/shared/keybindings.ts`):

1. A map stored with `$keybindingsSchema: "2"` is left alone. The marker lives inside the stored keybinding record, and `get()` strips it before the renderer sees the map.
2. The historical exact legacy maps (sparse LEGACY, and schema-1 merged with LEGACY with or without `move-pane-*`) become the new defaults.
3. Otherwise each action whose stored value equals a default that platform previously shipped moves to the new default:
   - the schema-1 map for that platform;
   - on a Mac, also the Ctrl-based map it saved before macOS had its own defaults;
   - the early sparse LEGACY value.

   Missing actions also get the new defaults. Customized values and unknown keys are kept.
4. If a moved default would equal one of the user's customized chords, the moved action is unassigned instead.

The migrated map is saved with the marker on the next settings write. The renderer writes its bindings on startup, so a later deliberate choice of an old key (for example F2) is kept.

## Addendum — 1 October 2026: projects replace terminal tabs

Sidebar entries are now always projects (see `docs/site/guide/workspaces.md`). Two shortcut changes follow.

### New project (`new-terminal`)

The action id stays `new-terminal` so stored bindings keep working, but it now opens **Create project** for the Workspace or Library entry that holds the active project (else the first Workspace, else the first Library entry, else first-run setup). The default keys do not change: `Ctrl+Shift+T` on Windows and Linux, `Cmd+T` on macOS. They already passed this audit; Windows Terminal, GNOME Terminal, kitty, iTerm2 and Terminal.app use the same keys for "new tab", which is now the closest equivalent of "new project". A user who customized the key keeps it with the new meaning.

### Add terminals to current project (`add-terminals`, new)

The pane **+** button ("Add terminals") gets its own action and is in the command palette.

| Candidate | Prior art | Conflicts found | Verdict |
| --- | --- | --- | --- |
| `` Ctrl+Shift+` `` | VS Code "Terminal: Create New Terminal" on Windows, Linux **and** macOS | xterm.js 6 sends nothing for it (`Keyboard.ts`: Ctrl+Shift only encodes `-`, `2`, `6`), so no shell, readline, ZLE, PSReadLine, vim, tmux or TUI key is lost. Not an OS key on Windows, GNOME, KDE or macOS (the Windows input-language hotkey can be set to a bare grave accent, not this chord). Not Ctrl+Alt/AltGr. Not a Monaco default. Not used by any other JaneT default. Plain `` Ctrl+` `` (NUL in real xterm) stays with the terminal because Shift must match. | **Chosen, all platforms** |
| `Ctrl+Shift+Enter` | kitty "new window" in the current layout | xterm.js sends `\r` for any Ctrl/Shift+Enter, so programs would lose an Enter variant some agent TUIs read; Monaco "insert line above". | Rejected |
| `Ctrl+Shift+N` | Windows Terminal / GNOME / kitty "new window" | Means a new *window* everywhere else; JaneT has no second window, so the mnemonic would mislead. | Rejected |
| `Ctrl+Shift+D` / `Alt+Shift+D` | Windows Terminal duplicate/split pane | `Alt+Shift+D` is Meta (`M-D`, readline kill-word) in shells; Windows Terminal's binding is a split, which JaneT already has on `Ctrl+Shift+5`. | Rejected |
| macOS `Cmd+D` / `Cmd+Shift+D` | iTerm2 and Terminal.app split pane | Captured app shortcuts preempt Monaco's `Cmd+D` (add next occurrence), a heavily used editor key; split is already `Cmd+\`. | Rejected |
| macOS `` Cmd+` `` | — | Reserved by macOS (cycle windows); `shortcutConflict` already warns. | Rejected |
| macOS `Cmd+Enter` | kitty new window | Monaco "insert line below" while the editor has focus. | Rejected |

So `add-terminals` defaults to `` Ctrl+Shift+` `` on every platform, matching VS Code exactly. On macOS this is a Control chord, like the existing `Ctrl+Tab` defaults, because the Command candidates are reserved or would take editor keys; Control+Shift+` still reaches no terminal program. `shortcutKeyFromEvent` maps the physical Backquote key when Shift produces `~` (US), `¬` (UK) or a dead key (German), so the chord follows the key, not the layout's character. The unit test that checks every default against `shortcutConflict` and for duplicates covers it on all three platforms.

### Migration (schema 3)

`KEYBINDINGS_SCHEMA_VERSION` is now `3`:

1. Schema 3 maps are left alone.
2. A schema 2 map keeps every stored value, including deliberate choices of old schema 1 defaults, and only gains defaults for actions it lacks (`add-terminals`). If that default equals one of the user's own chords, `add-terminals` is left unassigned.
3. Older maps (schema 1, legacy) migrate as before; `add-terminals` is a missing action there too and gets its default under the same collision rule.

## Verification limits

- Unit and component tests dispatch realistic `key`/`code` pairs.
- The e2e specs press the new chords through Playwright on Windows.
- Linux and macOS behavior of these chords is covered by unit and component tests and by CI e2e on Linux. It was not exercised natively on macOS in this pass.
- Real AltGr and IME layouts were not tested on hardware.
