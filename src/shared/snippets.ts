export interface Snippet {
  id: string;
  name: string;
  content: string;
}

const MAX_SNIPPET_ID_LENGTH = 128;
const MAX_SNIPPET_NAME_LENGTH = 120;
const MAX_SNIPPET_CONTENT_LENGTH = 100_000;

export function normalizeSnippets(value: unknown): Snippet[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  const names = new Set<string>();
  const snippets: Snippet[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const { id, name, content } = candidate as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof content !== 'string') continue;
    const normalizedId = id.trim();
    const normalizedName = name.trim();
    const nameKey = normalizedName.toLocaleLowerCase();
    if (
      !normalizedId || !normalizedName || !content.trim()
      || normalizedId.length > MAX_SNIPPET_ID_LENGTH
      || normalizedName.length > MAX_SNIPPET_NAME_LENGTH
      || content.length > MAX_SNIPPET_CONTENT_LENGTH
      || ids.has(normalizedId) || names.has(nameKey)
    ) continue;
    ids.add(normalizedId);
    names.add(nameKey);
    snippets.push({ id: normalizedId, name: normalizedName, content });
  }
  return snippets;
}

export function hasDuplicateSnippetName(
  snippets: readonly Snippet[],
  name: string,
  ignoredId?: string,
): boolean {
  const key = name.trim().toLocaleLowerCase();
  return snippets.some((snippet) => snippet.id !== ignoredId && snippet.name.toLocaleLowerCase() === key);
}

/** Preserve multi-line content but never submit a command through a trailing line ending. */
export function snippetTextForPaste(content: string): string {
  return content.replace(/[\r\n]+$/, '');
}
