import { isAbsolute, relative, resolve } from "node:path";

export type PickedAttachment = { relativePath: string; type: "file" | "directory" };

/**
 * Sorts what a native picker returned into attachments (inside the project, as
 * project-relative posix paths) and the paths that can't be attached because they
 * are outside it. `kindOf` says what a path is, or null when it no longer exists.
 */
export async function classifyPickedPaths(
  root: string,
  picked: string[],
  kindOf: (path: string) => Promise<"file" | "directory" | null>,
): Promise<{ attachments: PickedAttachment[]; rejected: string[] }> {
  const base = resolve(root);
  const attachments: PickedAttachment[] = [];
  const rejected: string[] = [];
  for (const path of picked) {
    const rel = relative(base, resolve(path));
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      rejected.push(path);
      continue;
    }
    const type = await kindOf(path);
    if (type) attachments.push({ relativePath: rel.split(/[\\/]/).join("/"), type });
  }
  return { attachments, rejected };
}
