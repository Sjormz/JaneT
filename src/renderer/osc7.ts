// OSC 7 helpers.
//
// OSC 7 is the escape sequence shells use to tell the terminal their current
// working directory as a `file://HOST/PATH` URL. xterm.js's OSC parser hands
// us one complete payload; this file validates it and converts it into a
// local filesystem path.
//
// Any program that writes to the terminal can emit OSC 7 (a nested SSH shell,
// a container, `cat` of an untrusted file), so the payload is treated as
// untrusted input:
//   - the URL authority must name this machine (empty, `localhost`, or this
//     machine's hostname) — reports from other hosts describe another
//     filesystem and are ignored;
//   - the path is percent-decoded exactly once (RFC 3986 / RFC 8089), and
//     malformed escapes, invalid UTF-8, control characters, relative paths and
//     over-long payloads are rejected;
//   - UNC forms (`file:////server/share`, i.e. a path beginning with `//`) are
//     rejected. Following them would make Explorer/Git contact an arbitrary SMB
//     server named by terminal output, which can leak Windows credentials.
//     Mapped drive letters still work.
// A rejected report returns null so the caller keeps the last valid cwd.
//
// References:
//   - RFC 8089 (file URI scheme): https://www.rfc-editor.org/rfc/rfc8089.html
//   - WezTerm shell integration: https://wezterm.org/shell-integration.html

/** Upper bound for an OSC 7 payload; longer reports are ignored. */
export const MAX_OSC7_PAYLOAD_LENGTH = 128 * 1024;

/** Upper bound for the decoded path (Windows extended-length paths are 32767 UTF-16 units). */
const MAX_PATH_LENGTH = 32_767;

const HOSTNAME_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.?$/;
// C0 controls, DEL and C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

function normalizeHostname(host: string): string {
  return host.toLowerCase().replace(/\.$/, '');
}

/**
 * Whether an OSC 7 authority names this machine. Empty and `localhost` are
 * always local. Otherwise the report must match `localHostname`
 * case-insensitively; a short name also matches the same host's FQDN
 * (`box` ↔ `box.example.com`), but two different FQDNs never match.
 */
export function isLocalOsc7Host(host: string, localHostname = ''): boolean {
  if (host === '') return true;
  if (!HOSTNAME_PATTERN.test(host)) return false;
  const reported = normalizeHostname(host);
  if (reported === 'localhost') return true;
  if (!localHostname || !HOSTNAME_PATTERN.test(localHostname)) return false;
  const local = normalizeHostname(localHostname);
  if (reported === local) return true;
  if (!reported.includes('.')) return local.startsWith(reported + '.');
  if (!local.includes('.')) return reported.startsWith(local + '.');
  return false;
}

/**
 * Convert an OSC 7 payload (the text between `\e]7;` and the terminator)
 * to a local filesystem path, or null when the report must be ignored.
 *
 *   file://localhost/home/alice                 → /home/alice
 *   file:///C:/Users/sjorm                      → C:/Users/sjorm
 *   file://localhost/home/alice/My%20Dir        → /home/alice/My Dir
 *   file://<this machine>/home/alice            → /home/alice
 *   file://remote.example/home/alice            → null (another host)
 *   file://localhost//server/share              → null (UNC not followed)
 *   file://localhost/C:/100%done                → null (malformed escape)
 *   not-a-url                                   → null
 */
export function fileUrlToPath(url: string, localHostname = ''): string | null {
  if (typeof url !== 'string' || url.length > MAX_OSC7_PAYLOAD_LENGTH) return null;
  if (!/^file:\/\//i.test(url)) return null;
  // Raw controls cannot be part of a URL. A raw `?` or `#` would start a
  // query/fragment, so a correctly encoding emitter never produces one; a
  // raw one means the path cannot be recovered unambiguously.
  if (CONTROL_CHARACTERS.test(url) || /[?#]/.test(url)) return null;

  const rest = url.slice('file://'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null; // no path
  const authority = rest.slice(0, slash);
  if (!isLocalOsc7Host(authority, localHostname)) return null;

  const encodedPath = rest.slice(slash);
  // Every `%` must start a valid escape. Treating a stray `%` as literal
  // would make `C:/100%done` and a correctly encoded `%25` ambiguous.
  if (/%(?![0-9A-Fa-f]{2})/.test(encodedPath)) return null;
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return null; // invalid UTF-8
  }
  if (path.length > MAX_PATH_LENGTH || CONTROL_CHARACTERS.test(path)) return null;
  // `//server/share` is RFC 8089's UNC-in-path form; see header comment.
  if (path.startsWith('//')) return null;
  // Shells report normalized absolute paths; dot segments indicate a
  // hand-crafted or relative report.
  if (path.split('/').some(segment => segment === '.' || segment === '..')) return null;

  // Windows drive form: `/C:/foo` → `C:/foo`, `/C:` → `C:/`.
  const drive = /^\/([A-Za-z]:)(\/.*)?$/.exec(path);
  if (drive) return drive[1] + (drive[2] ?? '/');
  // Any other drive-like or colon-prefixed first segment is malformed.
  if (/^\/[A-Za-z]:/.test(path)) return null;
  return path;
}
