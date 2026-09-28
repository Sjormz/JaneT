/**
 * Structured outcomes for Git IPC. Failures carry a short, sanitized,
 * length-limited explanation (never raw credentials) that the renderer can
 * show as-is.
 */
export type GitFailure = { ok: false; error: string };
export type GitActionResult = { ok: true } | GitFailure;
export type GitResult<T> = { ok: true; value: T } | GitFailure;

/** Upper bound for an error message sent to the renderer. */
export const MAX_GIT_ERROR_LENGTH = 400;
