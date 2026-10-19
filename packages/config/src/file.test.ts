import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConfigFile, writeConfigFile } from "./file.js";

describe("config file I/O", () => {
  it("writes and reads merged config", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-cfg-"));
    await writeConfigFile(root, {
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
      harness: { policy: "auto" },
    });

    const { config, exists } = await readConfigFile(root);
    expect(exists).toBe(true);
    expect(config.agents?.[0]?.model).toBe("echo");

    const raw = JSON.parse(await readFile(join(root, "yggdrasil.config.json"), "utf8")) as {
      agents: Array<{ model: string }>;
    };
    expect(raw.agents[0]?.model).toBe("echo");
  });
});
