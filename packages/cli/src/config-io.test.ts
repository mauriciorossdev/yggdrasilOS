import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConfigFile, writeConfigFile } from "./config-io.js";

describe("config-io plugin fields", () => {
  it("merges installed and disabled without duplicates", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-config-"));
    await writeConfigFile(root, {
      plugins: { installed: ["tool-a"], disabled: ["tool-b"] },
    });

    await writeConfigFile(root, {
      plugins: {
        installed: ["tool-a", "tool-weather"],
        disabled: [],
      },
    });

    const { config } = await readConfigFile(root);
    expect(config.plugins?.installed).toEqual(["tool-a", "tool-weather"]);
    expect(config.plugins?.disabled).toEqual([]);

    const raw = JSON.parse(await readFile(join(root, "yggdrasil.config.json"), "utf8")) as {
      plugins: { installed: string[] };
    };
    expect(raw.plugins.installed).toContain("tool-weather");
  });
});
