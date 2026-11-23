import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveSpawnCwd } from "./spawnCwd.js";

describe("resolveSpawnCwd", () => {
  const root = mkdtempSync(join(tmpdir(), "spawn-cwd-"));
  const file = join(root, "a-file");
  writeFileSync(file, "");
  const gone = join(root, "removed-worktree");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("keeps a folder that exists", () => {
    expect(resolveSpawnCwd(root, ["/elsewhere"])).toEqual({ cwd: root });
  });

  it("falls back to the first existing folder and reports the missing one", () => {
    expect(resolveSpawnCwd(gone, [undefined, join(root, "nope"), root])).toEqual({ cwd: root, missing: gone });
  });

  it("a file is not a folder to start in", () => {
    expect(resolveSpawnCwd(file, [root])).toEqual({ cwd: root, missing: file });
  });

  it("with no usable fallback keeps the original", () => {
    expect(resolveSpawnCwd(gone, [undefined, join(root, "nope")])).toEqual({ cwd: gone });
  });
});
