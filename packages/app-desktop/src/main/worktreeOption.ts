/**
 * Reads create_pane's `worktree` option. An MCP client (a model) can send the
 * boolean as the text "true" or "false"; taking that literally would create a
 * worktree *named* "true". So those words are booleans, not names.
 */
export function parseWorktreeOption(value: unknown): true | string | undefined {
  if (value === true) return true;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const lower = text.toLowerCase();
  if (lower === "true") return true;
  if (text === "" || lower === "false") return undefined;
  return text;
}
