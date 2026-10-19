import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { discoverPlugins, discoverNodeModulesPluginPaths } from "@yggdrasil/kernel";

describe("plugin discovery", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("discovers plugin under node_modules/@yggdrasil", async () => {
    tmp = await mkdtemp(join(tmpdir(), "yggdrasil-disc-"));
    const pluginRoot = join(tmp, "node_modules", "@yggdrasil", "tool-weather");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      join(pluginRoot, "yggdrasil.plugin.json"),
      JSON.stringify({
        id: "tool-weather",
        entry: "./dist/index.js",
        compat: { pluginApi: ">=0.3.0" },
      }),
    );

    const paths = await discoverNodeModulesPluginPaths(tmp);
    expect(paths.some((p) => p.endsWith("node_modules/@yggdrasil"))).toBe(true);

    const candidates = await discoverPlugins(paths);
    expect(candidates.some((c) => c.manifest.id === "tool-weather")).toBe(true);
  });
});
