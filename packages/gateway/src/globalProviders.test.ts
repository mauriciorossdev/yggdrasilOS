import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

import { homedir } from "node:os";
import { mergeConfig, writeGlobalProviders } from "@yggdrasil/config";
import { createDefaultGatewayContext } from "./methods.js";
import { watchGlobalProviders } from "./globalProviders.js";

describe("watchGlobalProviders", () => {
  beforeEach(async () => {
    (homedir as unknown as Mock).mockReturnValue(await mkdtemp(join(tmpdir(), "ygg-home-watch-")));
  });

  it("applies a save from another gateway to this one's running config", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygg-watch-"));
    const ctx = await createDefaultGatewayContext(mergeConfig({}, {}), null, root);
    const stop = watchGlobalProviders(ctx, 10);
    try {
      await writeGlobalProviders({ ollama: { baseUrl: "https://ollama.com", defaultModel: "gemma" } });
      await vi.waitFor(() => expect(ctx.config.providers?.ollama?.defaultModel).toBe("gemma"), { timeout: 3000, interval: 50 });
    } finally {
      stop();
    }
  });
});
