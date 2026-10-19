import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findConfigPath, resolveWorkspaceRoot } from "./workspace.js";

describe("resolveWorkspaceRoot", () => {
  it("finds config walking up from nested cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-workspace-"));
    const nested = join(root, "a", "b");
    await mkdir(nested, { recursive: true });
    await writeFile(join(root, "yggdrasil.config.json"), "{}", "utf8");

    const configPath = await findConfigPath(nested);
    expect(configPath).toBe(join(root, "yggdrasil.config.json"));

    const workspace = await resolveWorkspaceRoot(nested);
    expect(workspace).toBe(root);
  });

  it("uses YGGDRASIL_WORKSPACE when set", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-env-"));
    const prev = process.env.YGGDRASIL_WORKSPACE;
    process.env.YGGDRASIL_WORKSPACE = root;
    try {
      expect(await resolveWorkspaceRoot("/tmp/nowhere")).toBe(root);
    } finally {
      if (prev === undefined) delete process.env.YGGDRASIL_WORKSPACE;
      else process.env.YGGDRASIL_WORKSPACE = prev;
    }
  });
});
