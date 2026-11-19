import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type ResolvedPath = {
  /** Absolute path on disk. */
  abs: string;
  kind: "file" | "directory";
  /** Inside the project root (then `relativePath` is set, "" for the root itself). */
  insideProject: boolean;
  relativePath?: string;
};

/**
 * Where a path printed in a terminal could point, most likely first:
 * `~/x` → home; absolute → itself; relative → the pane's starting folder,
 * then the project root. `cwd` is the folder the pane was started in — a
 * later `cd` inside the pane isn't tracked, which is why the project root is
 * tried as well.
 */
export function candidatePaths(raw: string, cwd: string | null, projectRoot: string | null, home = homedir()): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text === "~" || text.startsWith("~/")) return [resolve(home, text.slice(2))];
  if (isAbsolute(text)) return [resolve(text)];
  const bases = [cwd, projectRoot].filter((b): b is string => Boolean(b));
  return [...new Set(bases.map((base) => resolve(base, text)))];
}

export function relativeToRoot(abs: string, projectRoot: string | null): string | null {
  if (!projectRoot) return null;
  const rel = relative(resolve(projectRoot), abs);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split("\\").join("/");
}

/** The first candidate that exists, or null. Only stats; never reads or opens anything. */
export async function resolveTerminalPath(
  raw: string,
  cwd: string | null,
  projectRoot: string | null,
): Promise<ResolvedPath | null> {
  for (const abs of candidatePaths(raw, cwd, projectRoot)) {
    const info = await stat(abs).catch(() => null);
    if (!info) continue;
    if (!info.isFile() && !info.isDirectory()) continue;
    const rel = relativeToRoot(abs, projectRoot);
    return {
      abs,
      kind: info.isDirectory() ? "directory" : "file",
      insideProject: rel !== null,
      ...(rel !== null ? { relativePath: rel } : {}),
    };
  }
  return null;
}
