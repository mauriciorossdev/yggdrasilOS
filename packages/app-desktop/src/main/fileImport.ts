import { cp, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export type ImportFilesResult = { imported: string[]; errors: string[] };

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Finder-style dedupe: "notes.md" -> "notes 2.md" -> "notes 3.md" if the name is already taken. */
async function uniqueDestName(dir: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  let n = 2;
  while (await pathExists(join(dir, candidate))) {
    candidate = `${stem} ${n}${ext}`;
    n++;
  }
  return candidate;
}

/**
 * Copies files/folders from anywhere on disk — a Finder drag or clipboard
 * paste, see FileTree.tsx's onDrop/onTreeKeyDown — into a folder inside the
 * project. Unlike the gateway's fs.* methods (workspaceRoot-scoped,
 * reachable by any connected client including an agent's tool calls), this
 * is Electron IPC only, callable solely from this app's own renderer in
 * response to a real user action — so reading an arbitrary absolute
 * sourcePath here is fine; it's never attacker/agent-controlled.
 */
export async function importExternalPaths(
  projectPath: string,
  destRelativePath: string,
  sourcePaths: string[],
): Promise<ImportFilesResult> {
  const resolvedRoot = resolve(projectPath);
  const destDir = resolve(resolvedRoot, destRelativePath);
  const rel = relative(resolvedRoot, destDir);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { imported: [], errors: ["destination escapes the project root"] };
  }

  const imported: string[] = [];
  const errors: string[] = [];

  for (const sourcePath of sourcePaths) {
    try {
      const name = await uniqueDestName(destDir, basename(sourcePath));
      const dest = join(destDir, name);
      await cp(sourcePath, dest, { recursive: true, errorOnExist: true });
      imported.push(name);
    } catch (err) {
      // A "file ID URL" from a clipboard paste (see clipboardFiles.ts's doc
      // comment) resolves to a /.file/id=... path that plain fs calls can't
      // actually read — give a pointer to the reliable path instead of a
      // bare ENOTDIR.
      const isFileIdPath = sourcePath.includes("/.file/id=");
      const message = isFileIdPath
        ? "macOS gave a reference this app can't read directly — try dragging the file from Finder instead of copy/paste"
        : err instanceof Error
          ? err.message
          : String(err);
      errors.push(`${basename(sourcePath)}: ${message}`);
    }
  }

  return { imported, errors };
}
