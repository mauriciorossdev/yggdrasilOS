import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Mock } from "vitest";

vi.mock("@yggdrasil/kernel", () => ({
  getKernelContext: vi.fn(),
}));

import { getKernelContext } from "@yggdrasil/kernel";
import { readConfigFile } from "@yggdrasil/config";
import type { GatewayHandler } from "@yggdrasil/sdk";
import plugin, { gcalCreateEventTool, gcalListEventsTool, gmailReadTool, gmailSearchTool } from "./index.js";

type FakeApi = {
  registerTool: Mock;
  registerGatewayMethod: Mock;
  logger: { info: Mock };
  gatewayMethods: Map<string, GatewayHandler>;
};

function fakeApi(): FakeApi {
  const gatewayMethods = new Map<string, GatewayHandler>();
  return {
    registerTool: vi.fn(),
    registerGatewayMethod: vi.fn((name: string, handler: GatewayHandler) => gatewayMethods.set(name, handler)),
    logger: { info: vi.fn() },
    gatewayMethods,
  };
}

describe("tool-google plugin registration", () => {
  it("registers all 4 v1 tools with the riskLevels the doc specifies", () => {
    const api = fakeApi();
    plugin.register(api as never);

    const registered = api.registerTool.mock.calls.map((c) => c[0]);
    const byName = (name: string) => registered.find((t) => t.name === name);

    expect(byName("gcal_list_events").riskLevel).toBe("safe");
    expect(byName("gcal_create_event").riskLevel).toBe("moderate");
    expect(byName("gmail_search").riskLevel).toBe("safe");
    expect(byName("gmail_read").riskLevel).toBe("safe");
    expect(registered).toHaveLength(4);
  });

  it("exports the same tool objects it registers (so other code, e.g. an MCP shim, can reuse them)", () => {
    const api = fakeApi();
    plugin.register(api as never);
    const registered = api.registerTool.mock.calls.map((c) => c[0]);
    expect(registered).toEqual(
      expect.arrayContaining([gcalListEventsTool, gcalCreateEventTool, gmailSearchTool, gmailReadTool]),
    );
  });

  it("registers exactly the three connectors.google gateway methods", () => {
    const api = fakeApi();
    plugin.register(api as never);
    expect([...api.gatewayMethods.keys()].sort()).toEqual([
      "connectors.google.authUrl",
      "connectors.google.completeAuth",
      "connectors.google.status",
    ]);
  });
});

describe("connectors.google.status", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-google-status-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
  });

  it("reports not connected when no account has ever been saved", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const result = await api.gatewayMethods.get("connectors.google.status")!({}, {} as never);
    expect(result).toEqual({ connected: false });
  });

  it("reports connected with scopes/connectedAt but never the refresh token, once one exists", async () => {
    const { saveGoogleAccount } = await import("./account.js");
    await saveGoogleAccount(workspaceRoot, {
      access_token: "at",
      refresh_token: "rt-secret",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.events",
      token_type: "Bearer",
    });

    const api = fakeApi();
    plugin.register(api as never);
    const result = (await api.gatewayMethods.get("connectors.google.status")!({}, {} as never)) as Record<
      string,
      unknown
    >;

    expect(result.connected).toBe(true);
    expect(result.scopes).toEqual(["https://www.googleapis.com/auth/calendar.events"]);
    expect(result.connectedAt).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("rt-secret");
  });
});

describe("connectors.google.authUrl / completeAuth handlers", () => {
  let workspaceRoot: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-ws-google-plugin-"));
    (getKernelContext as unknown as Mock).mockReturnValue({ workspaceRoot, config: {}, state: "running" });
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id-123";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-456";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("authUrl returns a real Google consent URL carrying a fresh state", async () => {
    const api = fakeApi();
    plugin.register(api as never);

    const result = (await api.gatewayMethods.get("connectors.google.authUrl")!({}, {} as never)) as {
      authUrl: string;
      state: string;
    };

    const url = new URL(result.authUrl);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("state")).toBe(result.state);
  });

  it("completeAuth rejects a state that was never issued by authUrl", async () => {
    const api = fakeApi();
    plugin.register(api as never);

    await expect(
      api.gatewayMethods.get("connectors.google.completeAuth")!({ code: "c", state: "made-up" }, {} as never),
    ).rejects.toThrow(/unknown or expired state/);
  });

  it("completeAuth exchanges the code and persists the refresh token — full round trip", async () => {
    const api = fakeApi();
    plugin.register(api as never);

    const { state } = (await api.gatewayMethods.get("connectors.google.authUrl")!({}, {} as never)) as {
      state: string;
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "at",
          refresh_token: "rt-real",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.events",
          token_type: "Bearer",
        }),
      }),
    );

    const result = (await api.gatewayMethods.get("connectors.google.completeAuth")!(
      { code: "the-code", state },
      {} as never,
    )) as { ok: boolean; connected: boolean };

    expect(result).toMatchObject({ ok: true, connected: true });

    const { config } = await readConfigFile(workspaceRoot);
    expect((config.connectors?.google?.accounts as { default: { refreshToken: string } })?.default?.refreshToken).toBe(
      "rt-real",
    );
  });

  it("completeAuth's state is single-use — replaying the same state a second time fails", async () => {
    const api = fakeApi();
    plugin.register(api as never);
    const { state } = (await api.gatewayMethods.get("connectors.google.authUrl")!({}, {} as never)) as {
      state: string;
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a", token_type: "Bearer" }),
      }),
    );

    await api.gatewayMethods.get("connectors.google.completeAuth")!({ code: "c1", state }, {} as never);
    await expect(
      api.gatewayMethods.get("connectors.google.completeAuth")!({ code: "c2", state }, {} as never),
    ).rejects.toThrow(/unknown or expired state/);
  });
});
