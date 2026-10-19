export type ExternalChange = "noop" | "reload" | "conflict";

/**
 * What an open Documents tab should do when its file's content on disk may
 * have changed under it (an agent edited the note, a git checkout, ...).
 *
 * - `noop`: disk matches what the tab last loaded/saved (also covers the
 *   tab's own Ctrl+S echoing back as a change event), or already matches the
 *   tab's content.
 * - `reload`: the tab has no unsaved edits, so just show the new content.
 * - `conflict`: the user has unsaved edits AND the file changed on disk —
 *   never overwrite either side silently; the caller offers a choice.
 */
export function reconcileExternalChange(
  tab: { content: string; savedContent: string },
  diskContent: string,
): ExternalChange {
  if (diskContent === tab.savedContent || diskContent === tab.content) return "noop";
  return tab.content === tab.savedContent ? "reload" : "conflict";
}
