// OSC 7 helpers.
//
// OSC 7 is the canonical escape sequence terminals use to receive the
// current working directory of the shell process. The shell emits it,
// the terminal's built-in OSC parser hands the payload to us, and we
// extract a local filesystem path from it.
//
// References:
//   - WezTerm shell-integration docs (canonical):
//     https://wezfurlong.org/wezterm/shell-integration.html
//   - VS Code Terminal Shell Integration:
//     https://code.visualstudio.com/docs/terminal/shell-integration
//
// xterm.js exposes a public OSC parser via `term.parser.registerOscHandler`,
// which handles sequence detection, chunk reassembly, terminators (ST vs
// BEL), and stripping the sequence from the visible output. We don't need
// any of that here — this file just converts one complete payload string
// into a local path.

/**
 * Convert an OSC 7 payload (the text between `\e]7;` and the terminator)
 * to a local filesystem path.
 *
 * The payload has the form `file://HOSTNAME/PATH`. Examples:
 *   file://localhost/home/alice                 → /home/alice
 *   file://localhost/C:/Users/sjorm             → C:/Users/sjorm
 *   file://localhost/home/alice/My%20Dir        → /home/alice/My Dir
 *   file://host/path                            → /path
 *   not-a-url                                   → null
 */
export function fileUrlToPath(url: string): string | null {
  if (!url.startsWith('file://')) return null;
  const rest = url.slice('file://'.length);
  const firstSlash = rest.indexOf('/');
  if (firstSlash < 0) return null; // no path
  let path = rest.slice(firstSlash + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }

  // Windows form: `file://host/C:/foo` — keep the drive letter.
  if (/^[A-Za-z]:/.test(path)) return path;

  // POSIX: `/path/with/slashes` — ensure leading slash.
  return '/' + path;
}
