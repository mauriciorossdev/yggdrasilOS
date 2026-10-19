import { describe, it, expect, afterEach } from "vitest";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bootstrapKernel,
  disposeKernel,
  resetKernelForTest,
  resetRegistryForTest,
  listPlugins,
} from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";

describe("npm plugin discovery", () => {
  let root: string;

  afterEach(async () => {
    await disposeKernel();
    resetRegistryForTest();
    resetKernelForTest();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("loads @yggdrasil/tool-weather from node_modules", async () => {
    root = await mkdtemp(join(tmpdir(), "ygg-nm-discovery-"));
    const nmScoped = join(root, "node_modules", "@yggdrasil");
    await mkdir(nmScoped, { recursive: true });

    const weatherPkg = join(process.cwd(), "packages", "tool-weather");
    await cp(weatherPkg, join(nmScoped, "tool-weather"), { recursive: true });

    resetRegistryForTest();
    resetKernelForTest();
    registerBuiltinHarnesses();

    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
      plugins: {
        discoverNodeModules: true,
        disabled: [],
        load: { paths: [] },
      },
      channels: { tui: { enabled: false }, echo: { enabled: false }, telegram: { enabled: false } },
    });

    const ctx = await bootstrapKernel({ config, workspaceRoot: root });
    const ids = listPlugins().map((p) => p.id);
    expect(ids).toContain("tool-weather");
    void ctx;
  });

  it("skips plugins listed in plugins.disabled", async () => {
    root = await mkdtemp(join(tmpdir(), "ygg-nm-disabled-"));
    const nmScoped = join(root, "node_modules", "@yggdrasil");
    await mkdir(nmScoped, { recursive: true });
    const weatherPkg = join(process.cwd(), "packages", "tool-weather");
    await cp(weatherPkg, join(nmScoped, "tool-weather"), { recursive: true });

    resetRegistryForTest();
    resetKernelForTest();
    registerBuiltinHarnesses();

    const config = mergeConfig(DEFAULT_CONFIG, {
      plugins: { discoverNodeModules: true, disabled: ["tool-weather"] },
    });

    await bootstrapKernel({ config, workspaceRoot: root });
    const ids = listPlugins().map((p) => p.id);
    expect(ids).not.toContain("tool-weather");
  });
});
