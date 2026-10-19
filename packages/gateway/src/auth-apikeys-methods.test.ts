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
import { mergeConfig, writeConfigFile } from "@yggdrasil/config";
import { invokeGatewayMethod } from "./server.js";

describe("auth.apiKeys gateway methods", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), "ygg-home-apikeys-"));
    (homedir as unknown as Mock).mockReturnValue(home);
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-apikeys-"));
    await writeConfigFile(workspaceRoot, {
      auth: {
        gateway: {
          required: true,
          apiKey: "legacy-shared-secret",
          apiKeys: [
            { key: "sk-phone-abcd1234", name: "Samsung (Alex)" },
            { key: "sk-desktop-wxyz9999", name: "Desktop backup", expiresAt: 4102444800000 },
          ],
        },
      },
    });
  });

  it("lists apiKeys with name/expiresAt/keyPreview but never the raw key", async () => {
    const config = mergeConfig({}, {});
    const result = (await invokeGatewayMethod("auth.apiKeys.list", {}, config, null, workspaceRoot)) as {
      apiKeys: Array<{ name: string; expiresAt?: number; keyPreview?: string }>;
    };

    expect(result.apiKeys).toHaveLength(2);
    const phone = result.apiKeys.find((k) => k.name === "Samsung (Alex)");
    expect(phone?.keyPreview).toBe("••••1234");
    expect(JSON.stringify(result)).not.toContain("sk-phone-abcd1234");
    expect(JSON.stringify(result)).not.toContain("sk-desktop-wxyz9999");

    const desktop = result.apiKeys.find((k) => k.name === "Desktop backup");
    expect(desktop?.expiresAt).toBe(4102444800000);
  });

  it("revokes an apiKey by name, persists it, and leaves the others (including the legacy single key) intact", async () => {
    const config = mergeConfig({}, {});
    const result = (await invokeGatewayMethod(
      "auth.apiKeys.revoke",
      { name: "Samsung (Alex)" },
      config,
      null,
      workspaceRoot,
    )) as { ok: boolean; revoked: string; remaining: number };

    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(1);

    const afterList = (await invokeGatewayMethod("auth.apiKeys.list", {}, config, null, workspaceRoot)) as {
      apiKeys: Array<{ name: string }>;
    };
    expect(afterList.apiKeys.map((k) => k.name)).toEqual(["Desktop backup"]);

    // Revoking a multi-key entry must not touch the legacy single apiKey or
    // the required:true flag — a hand-rolled patch that forgot to spread
    // current.auth.gateway would silently wipe both.
    const { readConfigFile } = await import("@yggdrasil/config");
    const { config: onDisk } = await readConfigFile(workspaceRoot);
    expect(onDisk.auth?.gateway?.apiKey).toBe("legacy-shared-secret");
    expect(onDisk.auth?.gateway?.required).toBe(true);
  });

  it("rejects revoking a name that doesn't exist", async () => {
    const config = mergeConfig({}, {});
    await expect(
      invokeGatewayMethod("auth.apiKeys.revoke", { name: "nope" }, config, null, workspaceRoot),
    ).rejects.toThrow(/no apiKey named/);
  });

  it("rejects revoke with no workspaceRoot", async () => {
    const config = mergeConfig({}, {});
    await expect(
      invokeGatewayMethod("auth.apiKeys.revoke", { name: "Samsung (Alex)" }, config, null, undefined),
    ).rejects.toThrow(/workspaceRoot/);
  });
});
