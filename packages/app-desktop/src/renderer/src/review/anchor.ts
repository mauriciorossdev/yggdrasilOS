import type { CodeComment } from "../types.js";

/**
 * Where a comment's lines are now. The file changes after an agent works on it,
 * so a comment keeps the text of the lines it was made on: if that text is
 * still at the saved lines, keep them; else take the occurrence nearest to the
 * saved start; else it's outdated (null). See notes/features/code-review-comments.md.
 */
export function locateComment(
  c: Pick<CodeComment, "startLine" | "endLine" | "snippet">,
  lines: readonly string[],
): { startLine: number; endLine: number } | null {
  const span = c.endLine - c.startLine + 1;
  const want = c.snippet.split("\n");
  // Comments saved without their text can only trust the line numbers.
  if (!c.snippet.trim()) return c.endLine <= lines.length ? { startLine: c.startLine, endLine: c.endLine } : null;
  const at = (start: number) => want.every((w, i) => (lines[start - 1 + i] ?? null)?.trimEnd() === w.trimEnd());
  if (c.startLine >= 1 && at(c.startLine)) return { startLine: c.startLine, endLine: c.startLine + span - 1 };
  let best: number | null = null;
  for (let start = 1; start + want.length - 1 <= lines.length; start++) {
    if (!at(start)) continue;
    if (best === null || Math.abs(start - c.startLine) < Math.abs(best - c.startLine)) best = start;
  }
  return best === null ? null : { startLine: best, endLine: best + want.length - 1 };
}
