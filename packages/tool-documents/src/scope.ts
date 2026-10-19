import { isAbsolute, relative, resolve } from "node:path";

const NOTES_ROOT = "notes";

/**
 * Resolves a caller-supplied relative path against <workspaceRoot>/notes,
 * rejecting any absolute path or ../ escape — mirrors
 * packages/gateway/src/methods.ts's resolveWithinRoot exactly, just with the
 * root fixed to the notes/ subfolder (the Documents feature's backing
 * folder) instead of the whole project. Unlike tool-system's filesystem
 * tools (list_directory/read_file/write_file), which never consult
 * ctx.workspaceRoot at all, this is the whole point of this package: these
 * tools are hard-scoped to notes/, not general-purpose.
 */
export function resolveWithinNotes(
  ctx: { workspaceRoot?: string },
  methodName: string,
  relativePath: string,
): string {
  if (!ctx.workspaceRoot) {
    throw new Error(`${methodName}: no workspaceRoot configured for this session`);
  }
  const notesRoot = resolve(ctx.workspaceRoot, NOTES_ROOT);
  const target = resolve(notesRoot, relativePath);
  const rel = relative(notesRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${methodName}: path escapes the notes/ (Documents) folder`);
  }
  return target;
}
