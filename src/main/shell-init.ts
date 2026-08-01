import * as path from 'path';

/** Complete private zero-width OSC emitted after prompt hooks complete. */
export const STARTUP_READY_MARKER = '\x1b]777;janet-ready\x1b\\';

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
      "if (-not $global:__jt_state) {",
      "  $global:__jt_state = @{ OriginalPrompt = $(if (Test-Path Function:\\prompt) { ${Function:prompt} } else { { 'PS> ' } }); OriginalPSConsoleHostReadLine = $null; InExecution = $false; UseNativeExitCode = $false }",
      "  if (Test-Path Function:\\PSConsoleHostReadLine) { $global:__jt_state.OriginalPSConsoleHostReadLine = ${Function:PSConsoleHostReadLine} }",
      "}",
      "if ($global:__jt_state.OriginalPSConsoleHostReadLine) {",
      "  function global:PSConsoleHostReadLine {",
      "    $line = $global:__jt_state.OriginalPSConsoleHostReadLine.Invoke()",
      "    if (-not [string]::IsNullOrWhiteSpace([string]$line)) {",
      "      $global:__jt_state.UseNativeExitCode = $false",
      "      try {",
      "        $tokens = $null; $errors = $null",
      "        $ast = [System.Management.Automation.Language.Parser]::ParseInput([string]$line, [ref]$tokens, [ref]$errors)",
      "        $lastStatement = if ($ast.EndBlock.Statements.Count -gt 0) { $ast.EndBlock.Statements[-1] }",
      "        $commands = if ($lastStatement -is [System.Management.Automation.Language.PipelineAst]) { @($lastStatement.PipelineElements) } else { @() }",
      "        foreach ($command in $commands) {",
      "          if ($command -isnot [System.Management.Automation.Language.CommandAst]) { continue }",
      "          $commandName = $command.GetCommandName()",
      "          $commandInfo = if ($commandName) { @(Get-Command -Name $commandName -ErrorAction SilentlyContinue)[0] }",
      "          while ($commandInfo -and $commandInfo.CommandType -eq 'Alias') { $commandInfo = $commandInfo.ResolvedCommand }",
      "          if ($commandInfo -and $commandInfo.CommandType -eq 'Application') { $global:__jt_state.UseNativeExitCode = $true; break }",
      "        }",
      "      } catch {}",
      "      [Console]::Write(([char]27) + ']133;C' + ([char]27) + ([char]92))",
      "      $global:__jt_state.InExecution = $true",
      "    }",
      "    $line",
      "  }",
      "}",
      "function global:prompt {",
      "  $__jt_success = $?",
      "  $__jt_last_exit_code = $global:LASTEXITCODE",
      "  $e = [char]27",
      "  $urlPath = ($PWD.ProviderPath -replace '\\\\','/')",
      "  $osc = $e + ']7;file://' + $env:COMPUTERNAME + '/' + $urlPath + $e + [char]92",
      "  $ready = $e + ']777;janet-ready' + $e + [char]92",
      "  if ($global:__jt_state.InExecution) {",
      "    $commandStatus = if ($__jt_success) { 0 } elseif ($global:__jt_state.UseNativeExitCode -and $null -ne $__jt_last_exit_code -and $__jt_last_exit_code -ne 0) { $__jt_last_exit_code } else { 1 }",
      "    Write-Host -NoNewline ($e + ']133;D;' + $commandStatus + $e + [char]92)",
      "    $global:__jt_state.InExecution = $false",
      "    $global:__jt_state.UseNativeExitCode = $false",
      "  }",
      "  Write-Host -NoNewline ($e + ']133;A' + $e + [char]92)",
      "  Write-Host -NoNewline $osc",
      "  $global:LASTEXITCODE = $__jt_last_exit_code",
      "  if ($__jt_success) { $null = $true } else { Write-Error '__janet_status__' -ErrorAction Ignore }",
      "  try {",
      "    $promptText = & $global:__jt_state.OriginalPrompt",
      "  } catch {",
      "    Microsoft.PowerShell.Utility\\Write-Error -ErrorRecord $_ -ErrorAction Continue",
      "    $promptText = 'PS> '",
      "  } finally {",
      "    Write-Host -NoNewline $ready",
      "  }",
      "  [string]$promptText + $e + ']133;B' + $e + [char]92",
      "}",
    ].join('\n');
    return ps;
  }

  // Bash. The canonical PROMPT_COMMAND snippet — also used by VS Code.
  if (base === 'bash' || base === 'bash.exe') {
    return [
      "__jt_already_installed() { [[ -n ${__jt_installed-} ]]; }",
      "if ! __jt_already_installed; then",
      "__jt_installed=1",
      // Use a namespaced function name so we don't clobber the user's.
      "__jt_osc7() { printf '\\033]7;file://%s%s\\033\\\\' \"${HOSTNAME:-localhost}\" \"$PWD\"; }",
      "__jt_ready() { printf '\\033]777;janet-ready\\033\\\\'; }",
      "__jt_restore_status() { return \"$1\"; }",
      "__jt_in_command=0",
      "__jt_debug_guard=1",
      "eval \"__jt_debug_terms=($(trap -p DEBUG))\"",
      "__jt_orig_debug_trap=${__jt_debug_terms[2]-}",
      // Bash 3.2 executes only PROMPT_COMMAND[0], so capture either form and
      // install one scalar wrapper that explicitly runs every original hook.
      "case \"$(declare -p PROMPT_COMMAND 2>/dev/null)\" in",
      "  'declare -a'*) __jt_orig_prompt_commands=(\"${PROMPT_COMMAND[@]}\") ;;",
      "  *) __jt_orig_prompt_commands=(\"${PROMPT_COMMAND-}\") ;;",
      "esac",
      "__jt_prompt_command() {",
      "  local __jt_status=$?",
      "  local __jt_command",
      "  __jt_debug_guard=1",
      "  if (( __jt_in_command )); then printf '\\033]133;D;%s\\033\\\\' \"$__jt_status\"; __jt_in_command=0; fi",
      "  __jt_osc7",
      "  for __jt_command in \"${__jt_orig_prompt_commands[@]}\"; do",
      "    __jt_restore_status \"$__jt_status\"",
      "    builtin eval -- \"$__jt_command\"",
      "  done",
      "  __jt_ready",
      "  __jt_debug_guard=0",
      "}",
      "unset PROMPT_COMMAND",
      "PROMPT_COMMAND=__jt_prompt_command",
      "PS1=\"\\[\\033]133;A\\033\\\\\\]${PS1}\\[\\033]133;B\\033\\\\\\]\"",
      // `type -t` is `file` only when no alias/function shadows the binary.
      "if [ \"$(type -t hermes 2>/dev/null)\" = file ]; then",
      // The `function name` form prevents an existing alias from expanding
      // the name while the shell parses this skipped conditional branch.
      "  function hermes {",
      "    if [ -n \"${TMUX:-}${STY:-}\" ]; then JANET_KITTY_GRAPHICS= KITTY_WINDOW_ID= WEZTERM_PANE= ITERM_SESSION_ID= TERM_PROGRAM=JaneT command hermes \"$@\"; else JANET_KITTY_GRAPHICS=1 command hermes \"$@\"; fi",
      "  }",
      "fi",
      "__jt_debug() {",
      "  local __jt_status=$?",
      "  (( __jt_debug_guard )) && return \"$__jt_status\"",
      "  [[ $BASH_COMMAND == __jt_* || $BASH_COMMAND == \"$PROMPT_COMMAND\" ]] && return \"$__jt_status\"",
      "  __jt_debug_guard=1",
      "  if (( ! __jt_in_command )); then printf '\\033]133;C\\033\\\\'; __jt_in_command=1; fi",
      "  if [[ -n $__jt_orig_debug_trap ]]; then __jt_restore_status \"$__jt_status\"; builtin eval -- \"$__jt_orig_debug_trap\"; fi",
      "  __jt_debug_guard=0",
      "  return \"$__jt_status\"",
      "}",
      "__jt_debug_guard=0",
      "trap '__jt_debug' DEBUG",
      "fi",
    ].join('\n');
  }

  // Zsh. The zsh-native way: a precmd hook.
  if (base === 'zsh' || base === 'zsh.exe') {
    return [
      "if [[ -z ${__jt_installed-} ]]; then",
      "typeset -g __jt_installed=1",
      "__jt_osc7() { print -Pn '\\e]7;file://%m%d\\a' }",
      "__jt_ready() { print -n $'\\e]777;janet-ready\\e\\\\' }",
      "autoload -Uz add-zsh-hook",
      "typeset -g __jt_in_command=0",
      "__jt_preexec() { (( __jt_in_command )) || { print -n $'\\e]133;C\\e\\\\'; __jt_in_command=1; } }",
      "__jt_precmd() { local status=$?; if (( __jt_in_command )); then print -n -- $'\\e]133;D;'${status}$'\\e\\\\'; __jt_in_command=0; fi; __jt_osc7; __jt_ready; return $status }",
      "add-zsh-hook -d preexec __jt_preexec 2>/dev/null",
      "add-zsh-hook -d precmd __jt_precmd 2>/dev/null",
      "add-zsh-hook preexec __jt_preexec",
      "add-zsh-hook precmd __jt_precmd",
      "PS1=$'%{\\e]133;A\\e\\\\%}'${PS1}$'%{\\e]133;B\\e\\\\%}'",
      "if (( $+commands[hermes] && ! $+aliases[hermes] && ! $+galiases[hermes] && ! $+functions[hermes] )); then",
      "  function hermes {",
      // Quote the external command name so a zsh global alias cannot expand
      // it while this compound statement is parsed.
      "    if [[ -n \"${TMUX:-}${STY:-}\" ]]; then JANET_KITTY_GRAPHICS= KITTY_WINDOW_ID= WEZTERM_PANE= ITERM_SESSION_ID= TERM_PROGRAM=JaneT command 'hermes' \"$@\"; else JANET_KITTY_GRAPHICS=1 command 'hermes' \"$@\"; fi",
      "  }",
      "fi",
      "fi",
    ].join('\n');
  }

  // Fish. The fish-prompt event handler.
  if (base === 'fish' || base === 'fish.exe') {
    return [
      "if not set -q __jt_fish_installed",
      "set -g __jt_fish_installed 1",
      "functions -e __jt_preexec __jt_postexec 2>/dev/null",
      "function __jt_restore_status; return $argv[1]; end",
      "function __jt_preexec --on-event fish_preexec; printf '\\033]133;C\\033\\\\'; set -g __jt_in_command 1; end",
      "function __jt_postexec --on-event fish_postexec; set -g __jt_last_status $status; end",
      "if functions -q fish_mode_prompt; and not functions -q __jt_orig_fish_mode_prompt; functions -c fish_mode_prompt __jt_orig_fish_mode_prompt; end",
      "if functions -q fish_prompt; and not functions -q __jt_orig_fish_prompt; functions -c fish_prompt __jt_orig_fish_prompt; end",
      "function fish_mode_prompt; set -l __jt_status $status; if functions -q __jt_orig_fish_mode_prompt; __jt_restore_status $__jt_status; __jt_orig_fish_mode_prompt $argv; end; end",
      "function fish_prompt",
      "  set -l __jt_status $status",
      "  if test \"$__jt_in_command\" = 1; printf '\\033]133;D;%s\\033\\\\' $__jt_last_status; set -g __jt_in_command 0; end",
      "  printf '\\033]133;A\\033\\\\'",
      "  printf '\\033]7;file://%s%s\\033\\\\' (hostname) $PWD",
      "  if functions -q __jt_orig_fish_prompt; __jt_restore_status $__jt_status; __jt_orig_fish_prompt $argv; end",
      "  printf '\\033]133;B\\033\\\\'",
      "end",
      // Fish evaluates fish_right_prompt after fish_prompt; preserve that
      // function too and emit readiness
      // through stderr so it reaches the PTY even when Fish hides an over-wide
      // right prompt instead of rendering its captured stdout.
      "if functions -q fish_right_prompt",
      "  if not functions -q __jt_orig_fish_right_prompt; functions -c fish_right_prompt __jt_orig_fish_right_prompt; end",
      "  function fish_right_prompt",
      "    set -l __jt_status $status",
      "    __jt_restore_status $__jt_status; __jt_orig_fish_right_prompt $argv",
      "    printf '\\033]777;janet-ready\\033\\\\' >&2",
      "  end",
      "else",
      "  function fish_right_prompt",
      "    printf '\\033]777;janet-ready\\033\\\\' >&2",
      "  end",
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
      "end",
    ].join('\n');
  }

  // cmd.exe has no scripting facility for per-prompt hooks. We could
  // fall back to a polling approach (read the cwd via the win32 API on
  // a timer) but that's out of scope for this fix. For now, return
  // empty so cmd.exe gets no init.
  return '';
}
