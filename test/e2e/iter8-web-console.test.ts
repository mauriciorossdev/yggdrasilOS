import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeConfigFile } from "@yggdrasil/config";
import { createTestPlatform, GatewayWsClient } from "../helpers/index.js";

describe("iter8 web console e2e", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;
  let workspaceDir: string | undefined;

  afterEach(async () => {
    await platform?.close();
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true });
      workspaceDir = undefined;
    }
  });

  async function isolatedPlatform(
    configOverride: Parameters<typeof createTestPlatform>[0]["configOverride"],
  ) {
    workspaceDir = await mkdtemp(join(tmpdir(), "ygg-iter8-"));
    await writeConfigFile(workspaceDir, {
      agents: [{ id: "default", provider: "builtin", model: "echo" }],
      harness: { policy: "auto" },
      ...configOverride,
    });
    return createTestPlatform({
      startServer: true,
      withLlmPlugins: false,
      workspaceRoot: workspaceDir,
      configOverride: {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
        harness: { policy: "auto" },
        ...configOverride,
      },
    });
  }

  it("GET /ui returns HTML when ui bundle exists", async () => {
    platform = await isolatedPlatform({});

    const res = await fetch(`http://127.0.0.1:${platform.gatewayPort}/ui`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("config.get and config.patch via WebSocket", async () => {
    platform = await isolatedPlatform({ harness: { policy: "auto" } });

    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);

    const got = await client.call<{ config: { harness?: { policy?: string } } }>("config.get");
    expect(got.result.config.harness?.policy).toBe("auto");

    const patched = await client.call<{ ok: boolean; requiresRestart: boolean }>("config.patch", {
      harness: { policy: "pinned", pinnedId: "builtin-echo" },
    });
    expect(patched.result.ok).toBe(true);
    expect(patched.result.requiresRestart).toBe(false); // harness is hot-reloadable
    client.close();
  });
});
