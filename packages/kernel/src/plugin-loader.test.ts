import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { discoverPlugins } from "./plugin-loader.js";

describe("discoverPlugins", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds plugins reached through a symlinked package dir (pnpm's node_modules layout)", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-plugin-loader-"));
    dirs.push(root);

    // Real package dir, elsewhere on disk (as pnpm's content-addressed store would be).
    const realPkgDir = join(root, "real-pkg");
    await mkdir(realPkgDir, { recursive: true });
    await writeFile(
      join(realPkgDir, "yggdrasil.plugin.json"),
      JSON.stringify({
        id: "symlinked-test-plugin",
        kind: ["tool"],
        entry: "./index.js",
        name: "Symlinked Test Plugin",
        version: "0.0.1",
        compat: { pluginApi: ">=0.3.0" },
      }),
    );

    // node_modules/@yggdrasil/<name> — a symlink to the real dir, exactly
    // like pnpm produces (this is what discoverNodeModulesPluginPaths finds).
    const searchDir = join(root, "node_modules", "@yggdrasil");
    await mkdir(searchDir, { recursive: true });
    const linkPath = join(searchDir, "real-pkg");
    await symlink(realPkgDir, linkPath, process.platform === "win32" ? "junction" : "dir");

    const candidates = await discoverPlugins([searchDir]);

    expect(candidates.map((c) => c.manifest.id)).toContain("symlinked-test-plugin");
  });
});
