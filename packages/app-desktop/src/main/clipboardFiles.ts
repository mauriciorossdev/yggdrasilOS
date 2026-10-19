import { clipboard } from "electron";
import { fileURLToPath } from "node:url";

/**
 * Reads file/folder paths off the OS clipboard after a Finder/Explorer
 * "Copy" — NOT the same as `clipboardData.files` in a DOM paste event,
 * which Chromium leaves empty for a real OS file copy (that API path is
 * really for pasting raw file blobs, e.g. a copied image). This goes
 * through Electron's `clipboard` module instead, which reads the OS
 * pasteboard directly.
 *
 * macOS only for now: Finder puts the copied item's NSURL under the
 * `public.file-url` UTI, which Electron's clipboard.read() hands back as a
 * `file://` string. Only the single "general" pasteboard item is readable
 * this way (no built-in Electron API enumerates multiple pasteboard items),
 * so a multi-file Finder copy only yields the first one. Windows/Linux
 * aren't wired up here — Electron has no equivalent built-in API for
 * CF_HDROP/text-uri-list, so this returns an empty list there (same as
 * "clipboard has nothing"), rather than guessing at partial support.
 *
 * Known gap even on macOS: for some files (observed with a PDF in
 * ~/Downloads) Finder puts a "file ID URL" on the pasteboard instead —
 * `file:///.file/id=<n>.<m>` — which fileURLToPath() turns into a path that
 * doesn't actually resolve via plain POSIX stat/open (confirmed: ENOTDIR),
 * only through Cocoa APIs Electron doesn't expose. importExternalPaths will
 * just report that path as failed; dragging the same file from Finder onto
 * the tree (FileTree.tsx's onDrop, using dataTransfer.files' real `.path`)
 * works regardless of this quirk and is the reliable path.
 */
export function readClipboardFilePaths(): string[] {
  if (process.platform !== "darwin") return [];
  if (!clipboard.has("public.file-url")) return [];

  const raw = clipboard.read("public.file-url").trim();
  if (!raw.startsWith("file://")) return [];
  try {
    return [fileURLToPath(raw)];
  } catch {
    return [];
  }
}
