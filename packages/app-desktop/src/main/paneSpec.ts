import { stat } from "node:fs/promises";
import { relative } from "node:path";
import { resolveWithinNotes } from "@yggdrasil/tool-documents";

/** Thrown for a bad `specPath` — the HTTP handler maps it to 400 (never typed into the pty). */
export class SpecPathError extends Error {}

/**
 * Validates a write_pane `specPath` and resolves it to an absolute file the
 * worker can read with any tool. Accepts the project-relative form the UI and
 * native Read/Write use (`notes/features/x.md`) and the notes-relative form
 * the `documents` MCP tools use (`features/x.md`); confinement to <project>/notes
 * is delegated to resolveWithinNotes (the same check the documents tools and
 * sync use), so `..` and absolute paths are rejected.
 */
export async function resolveSpecFile(
  projectPath: string,
  specPath: string,
): Promise<{ absolutePath: string; projectRelativePath: string }> {
  const cleaned = specPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const notesRelative = cleaned.startsWith("notes/") ? cleaned.slice("notes/".length) : cleaned;
  if (!notesRelative || notesRelative.endsWith("/")) {
    throw new SpecPathError("specPath must point at a file inside the project's notes/ folder");
  }
  let absolutePath: string;
  try {
    absolutePath = resolveWithinNotes({ workspaceRoot: projectPath }, "write_pane", notesRelative);
  } catch {
    throw new SpecPathError("specPath must stay inside the project's notes/ (Documents) folder");
  }
  const isFile = await stat(absolutePath).then(
    (s) => s.isFile(),
    () => false,
  );
  if (!isFile) {
    throw new SpecPathError(
      `spec file not found: notes/${notesRelative}. Write the feature doc first (write_document with path "${notesRelative}"), then call write_pane again.`,
    );
  }
  return {
    absolutePath,
    projectRelativePath: relative(projectPath, absolutePath).replace(/\\/g, "/"),
  };
}

/**
 * The text typed into the worker. The absolute path is used on purpose: a pane
 * can be created with its own `cwd`, and only an absolute path reads correctly
 * from any working directory.
 */
export function composeSpecMessage(absolutePath: string, text?: string): string {
  const read = `Read the feature doc at ${absolutePath} in full before doing anything else.`;
  const rest = text?.trim()
    ? text.trim()
    : "Do the open tasks assigned to you. Tick a box only with observed proof, append what you did to ## Log, then reply with a 2-line summary.";
  return `${read} ${rest}`;
}
