/**
 * Folder tabs share the same `openPaths: string[]` list as file tabs in
 * DocumentsView/FilesView. A trailing "/" marks a folder ("src/" or "/" for
 * the project root), so every file-only code path (fs.read, save, autosave,
 * external-change reload) skips it just by never having a TabState for it.
 */

export function isFolderTab(key: string): boolean {
  return key.endsWith("/");
}

/** Tab key for a project-relative folder path ("" or "." is the project root). */
export function folderTabKey(dir: string): string {
  const clean = dir.replace(/^\.\/?/, "").replace(/\/+$/, "");
  return `${clean}/`;
}

/** Project-relative folder path for a folder tab key ("" for the root). */
export function folderOfTab(key: string): string {
  return key.replace(/\/+$/, "");
}

/** Last path segment, for a tab label; the project root uses `rootLabel`. */
export function tabLabel(key: string, rootLabel: string): string {
  const path = isFolderTab(key) ? folderOfTab(key) : key;
  if (!path) return rootLabel;
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Moves a folder tab to another folder in place (same slot in the tab strip),
 * like navigating inside a Finder window. If the destination is already open
 * elsewhere, the current tab is dropped instead so it isn't listed twice.
 */
export function navigateFolderTab(openPaths: string[], fromKey: string, toKey: string): string[] {
  if (fromKey === toKey) return openPaths;
  const idx = openPaths.indexOf(fromKey);
  if (openPaths.includes(toKey)) return openPaths.filter((p) => p !== fromKey);
  if (idx === -1) return [...openPaths, toKey];
  const next = openPaths.slice();
  next[idx] = toKey;
  return next;
}
