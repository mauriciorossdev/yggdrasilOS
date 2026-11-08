import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CAPTURES_DIR } from "./browserCaptureBundle.js";

/**
 * Writes a capture bundle under <project>/.yggdrasil/captures/ and returns its
 * project-relative path. The directory ignores itself (a `.gitignore` holding
 * `*`), so bundles — transient working files for an agent — never show up as
 * untracked changes in the user's repo.
 */
export async function writeCaptureBundle(projectPath: string, fileName: string, content: string): Promise<string> {
  const dir = join(projectPath, CAPTURES_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", { flag: "w" });
  await writeFile(join(dir, fileName), content, { flag: "wx" });
  return `${CAPTURES_DIR}/${fileName}`;
}
