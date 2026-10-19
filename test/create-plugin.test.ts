import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import { createPluginProject } from "../packages/cli/src/create-plugin.ts";

describe("create-plugin", () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("generates valid tool plugin files", async () => {
    tmp = await mkdtemp(join(tmpdir(), "yggdrasil-create-"));
    const out = join(tmp, "my-tool");
    await createPluginProject({ name: "my-tool", kind: "tool", outputDir: out });

    await access(join(out, "yggdrasil.plugin.json"));
    await access(join(out, "src/index.ts"));
    const manifest = JSON.parse(await readFile(join(out, "yggdrasil.plugin.json"), "utf8")) as {
      id: string;
      entry: string;
    };
    expect(manifest.id).toBe("my-tool");
    expect(manifest.entry).toBe("./dist/index.js");
  });
});
