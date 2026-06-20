/**
 * Parse the `readingChapterOrder` multipart field (always a string from
 * NoFilesInterceptor) into a 1-based chapter order, or null.
 *
 * Null means "the user has no chapter open" (CONCEPT novel / empty pane). The
 * value is a snapshot taken at run start — it is closure-injected into the
 * agent tool, never read from LLM input.
 */
export function parseReadingChapterOrder(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}
