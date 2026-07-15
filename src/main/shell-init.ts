import * as path from 'path';

/**
 * Returns a small shell-init snippet that, when sourced/eval'd by the
 * shell at startup:
 *
 * - emits an OSC 7 escape sequence (file://HOST/PATH) before every prompt,
 *   so JaneT can keep its cwd-aware UI in sync; and
 * - in supported Unix shells, opts a directly invoked Hermes CLI into JaneT's
 *   deliberately narrow Kitty PNG renderer without exporting that capability
 *   to every process.
 *
 * The Hermes wrapper is installed only when `hermes` currently resolves to
 * an external command, so a user's alias or function is never replaced. It
 * scopes JANET_KITTY_GRAPHICS to that invocation and explicitly disables it
 * behind tmux/screen, whose passthrough support is not guaranteed.
 *
 * Returns the empty string for shells we don't know how to instrument
 * (or `cmd.exe`, which has no scripting facility that can run on each
 * prompt without external tools).
 *
 * References:
 *   - WezTerm shell integration (canonical):
 *     https://wezfurlong.org/wezterm/shell-integration.html
 *   - PowerShell prompt override:
 *     https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_prompts
 */
export function buildShellInit(shell: string): string {
  const base = path.basename(shell).toLowerCase();

  // PowerShell (any version — both 5.1 and 7+). The trick: capture the
  // existing prompt function, then redefine it so it emits OSC 7 first
  // and then calls the original. This works regardless of whether the
  // user has a custom prompt or not.
  if (base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe') {
    // We construct the OSC 7 escape sequence in PowerShell itself
    // (using [char]27 for ESC and string concatenation) rather than
    // embedding raw escape bytes in the JS source. That way we avoid
    // every form of double-escaping and PowerShell string-literal
    // quoting issue.
    //
    // The OSC 7 sequence we want PowerShell to print is:
    //   ESC ] 7 ; file://HOST/PATH ESC \
    // where the final "ESC \" is the ST (String Terminator). xterm's
    // parser accepts this on Windows, and we also accept BEL (0x07)
    // as a fallback (see src/renderer/osc7.ts / the xterm parser docs).
    const ps = [
      // Save the original prompt (or fall back to a simple one).
      "if (Test-Path Function:\\prompt) { $global:__jt_orig_prompt = ${Function:prompt} } else { $global:__jt_orig_prompt = { 'PS> ' } }",
      // Redefine prompt.
      "function global:prompt {",
      "  $e = [char]27",
      // Convert C:\foo to C:/foo (file:// wants forward slashes).
      "  $urlPath = ($PWD.ProviderPath -replace '\\\\','/')",
      // Build: ESC ] 7 ; file://HOST/PATH ESC \  (ST terminator).
      // Using single quotes for the literal so PowerShell doesn't try
      // to interpolate the escape characters. The trailing backslash
      // is [char]92 — the backslash in ST. xterm's parser also accepts
      // BEL ([char]7) as an alternative terminator, but ST is canonical.
      "  $osc = $e + ']7;file://' + $env:COMPUTERNAME + '/' + $urlPath + $e + [char]92",
      "  Write-Host -NoNewline $osc",
      "  & $global:__jt_orig_prompt",
      "}",
    ].join('\n');
    return ps;
  }

  // Bash. The canonical PROMPT_COMMAND snippet — also used by VS Code.
  if (base === 'bash' || base === 'bash.exe') {
    return [
      // Use a namespaced function name so we don't clobber the user's.
      "__jt_osc7() { printf '\\033]7;file://%s%s\\033\\\\' \"${HOSTNAME:-localhost}\" \"$PWD\"; }",
      // Prepend to any existing PROMPT_COMMAND.
      "PROMPT_COMMAND=\"__jt_osc7${PROMPT_COMMAND:+; $PROMPT_COMMAND}\"",
      // `type -t` is `file` only when no alias/function shadows the binary.
      "if [ \"$(type -t hermes 2>/dev/null)\" = file ]; then",
      // The `function name` form prevents an existing alias from expanding
      // the name while the shell parses this skipped conditional branch.
      "  function hermes {",
      "    if [ -n \"${TMUX:-}${STY:-}\" ]; then JANET_KITTY_GRAPHICS= KITTY_WINDOW_ID= WEZTERM_PANE= ITERM_SESSION_ID= TERM_PROGRAM=JaneT command hermes \"$@\"; else JANET_KITTY_GRAPHICS=1 command hermes \"$@\"; fi",
      "  }",
      "fi",
    ].join('\n');
  }

  // Zsh. The zsh-native way: a precmd hook.
  if (base === 'zsh' || base === 'zsh.exe') {
    return [
      "__jt_osc7() { print -Pn '\\e]7;file://%m%d\\a' }",
      "precmd_functions+=(__jt_osc7)",
      "if (( $+commands[hermes] && ! $+aliases[hermes] && ! $+galiases[hermes] && ! $+functions[hermes] )); then",
      "  function hermes {",
      // Quote the external command name so a zsh global alias cannot expand
      // it while this compound statement is parsed.
      "    if [[ -n \"${TMUX:-}${STY:-}\" ]]; then JANET_KITTY_GRAPHICS= KITTY_WINDOW_ID= WEZTERM_PANE= ITERM_SESSION_ID= TERM_PROGRAM=JaneT command 'hermes' \"$@\"; else JANET_KITTY_GRAPHICS=1 command 'hermes' \"$@\"; fi",
      "  }",
      "fi",
    ].join('\n');
  }

  // Fish. The fish-prompt event handler.
  if (base === 'fish' || base === 'fish.exe') {
    return [
      "function __jt_osc7 --on-event fish_prompt",
      "  printf '\\033]7;file://%s%s\\033\\\\' (hostname) $PWD",
      "end",
      "if type -q hermes; and test (type -t hermes) = file",
      "  function hermes --description 'Hermes with JaneT graphics'",
      "    if test -n \"$TMUX$STY\"",
      "      set -lx JANET_KITTY_GRAPHICS ''",
      "      set -lx KITTY_WINDOW_ID ''",
      "      set -lx WEZTERM_PANE ''",
      "      set -lx ITERM_SESSION_ID ''",
      "      set -lx TERM_PROGRAM JaneT",
      "    else",
      "      set -lx JANET_KITTY_GRAPHICS 1",
      "    end",
      "    command hermes $argv",
      "  end",
      "end",
    ].join('\n');
  }

  // cmd.exe has no scripting facility for per-prompt hooks. We could
  // fall back to a polling approach (read the cwd via the win32 API on
  // a timer) but that's out of scope for this fix. For now, return
  // empty so cmd.exe gets no init.
  return '';
}
