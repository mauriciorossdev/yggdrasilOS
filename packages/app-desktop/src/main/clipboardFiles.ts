import { clipboard, ClipboardItem } from "electron";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Reads file/folder paths off the OS clipboard after a Finder/Explorer
 * "Copy" — NOT the same as `clipboardData.files` in a DOM paste event,
 * which Chromium leaves empty for a real OS file copy (that API path is
 * really for pasting raw file blobs, e.g. a copied image). This goes
 * through Electron's `clipboard` module instead, which reads the OS
 * pasteboard directly.
 *
 * macOS only for now: Finder puts the copied item's NSURL under the
 * `public.file-url` UTI, which Electron's clipboard.read() exposes as an item
 * whose Blob text is a `file://` string. Only the single "general" pasteboard item is readable
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
export async function readClipboardFilePaths(): Promise<string[]> {
  if (process.platform !== "darwin") return [];

  // A copy from this app (writeClipboardFilePaths) or Finder with several items
  // carries the whole list here.
  const plist = await readRawFormat("NSFilenamesPboardType");
  const many = plist ? parseMacFilenamesPlist(plist) : [];
  if (many.length > 0) return many;

  const url = firstFileUrl((await readRawFormat("public.file-url")) ?? "");
  if (!url) return [];
  try {
    return [fileURLToPath(url)];
  } catch {
    return [];
  }
}

/** How Electron 45's W3C-shaped clipboard names a platform format such as a macOS pasteboard type. */
export function rawClipboardType(format: string): string {
  return `electron application/osclipboard;format="${format}"`;
}

async function readRawFormat(format: string): Promise<string | null> {
  const type = rawClipboardType(format);
  if (!(await clipboard.has(type))) return null;
  for (const item of await clipboard.read()) {
    if (!item.types.includes(type)) continue;
    const payload = await item.getType(type);
    if (payload instanceof Blob) return payload.text();
  }
  return null;
}

function writeRawFormat(format: string, text: string): Promise<void> {
  return clipboard.write([new ClipboardItem({ [rawClipboardType(format)]: new Blob([Buffer.from(text, "utf8")]) })]);
}

/** A file URL pasteboard entry can carry several lines; paths come from the first file:// one. */
export function firstFileUrl(text: string): string | null {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("file://")) ?? null;
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeXml = (text: string): string => text.replace(/[&<>]/g, (c) => XML_ESCAPES[c]!);
const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The pasteboard payload Finder reads for "files": an XML property list holding an array of absolute paths. */
export function macFilenamesPlist(paths: string[]): string {
  const items = paths.map((p) => `<string>${escapeXml(p)}</string>`).join("");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' +
    `<plist version="1.0"><array>${items}</array></plist>`
  );
}

/** Reads the paths back out of that property list (XML form only; anything else gives an empty list). */
export function parseMacFilenamesPlist(xml: string): string[] {
  const array = /<array>([\s\S]*?)<\/array>/.exec(xml)?.[1];
  if (!array) return [];
  return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unescapeXml(m[1]!)).filter(Boolean);
}

/** GNOME-family file managers (Nautilus, Nemo, Caja) paste from this format: the action, then one file URI per line. */
export function gnomeCopiedFiles(paths: string[]): string {
  return `copy\n${paths.map((p) => pathToFileURL(p).href).join("\n")}`;
}

export type WriteClipboardFilesResult = { ok: boolean; error?: string };

/**
 * Puts files/folders on the OS clipboard the way a file manager's Copy does, so
 * a paste in Finder/Explorer/the file tree copies them. Each platform has its
 * own format and Electron wraps none of them for files:
 *  - macOS: NSFilenamesPboardType (a plist of paths).
 *  - Windows: a CF_HDROP list, set through PowerShell's Set-Clipboard (paths go
 *    in an environment variable, so no quoting can break them).
 *  - Linux: x-special/gnome-copied-files (GNOME-family managers; Dolphin reads
 *    text/uri-list instead and won't see this).
 */
export async function writeClipboardFilePaths(paths: string[]): Promise<WriteClipboardFilesResult> {
  if (paths.length === 0) return { ok: false, error: "Nothing to copy." };
  try {
    if (process.platform === "darwin") {
      await writeRawFormat("NSFilenamesPboardType", macFilenamesPlist(paths));
      return { ok: true };
    }
    if (process.platform === "win32") {
      await new Promise<void>((resolve, reject) => {
        execFile(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath ($env:YGG_CLIP_PATHS -split \"`n\")"],
          { env: { ...process.env, YGG_CLIP_PATHS: paths.join("\n") }, windowsHide: true },
          (error) => (error ? reject(error) : resolve()),
        );
      });
      return { ok: true };
    }
    await writeRawFormat("x-special/gnome-copied-files", gnomeCopiedFiles(paths));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
