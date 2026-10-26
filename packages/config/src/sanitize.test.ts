import { describe, it, expect } from "vitest";
import { mergeConfig } from "./index.js";
import { sanitizeConfigForClient } from "./sanitize.js";

describe("sanitizeConfigForClient", () => {
  it("masks api keys and tokens", () => {
    const config = mergeConfig(
      {},
      {
        auth: { gateway: { apiKey: "secret-gw", required: true } },
        providers: { "openai-compat": { apiKey: "sk-123", baseUrl: "https://api.openai.com/v1" } },
        channels: {
          http: { enabled: true, accounts: { default: { token: "http-tok", port: 18790 } } },
          telegram: { enabled: false, accounts: { default: { botToken: "tg-bot" } } },
        },
      },
    );

    const sanitized = sanitizeConfigForClient(config);
    expect(sanitized.auth?.gateway?.apiKey).toBe("***");
    expect(sanitized.providers?.["openai-compat"]?.apiKey).toBe("***");
    expect(sanitized.providers?.["openai-compat"]?.baseUrl).toBe("https://api.openai.com/v1");
    expect(
      (sanitized.channels?.http?.accounts as { default: { token: string } })?.default?.token,
    ).toBe("***");
    expect(
      (sanitized.channels?.telegram?.accounts as { default: { botToken: string } })?.default
        ?.botToken,
    ).toBe("***");
  });

  it("preserves editable harness and agents", () => {
    const config = mergeConfig(
      {},
      {
        agents: [{ id: "default", provider: "builtin", model: "echo" }],
        harness: { policy: "pinned", pinnedId: "builtin-echo" },
      },
    );
    const sanitized = sanitizeConfigForClient(config);
    expect(sanitized.agents?.[0]?.model).toBe("echo");
    expect(sanitized.harness?.pinnedId).toBe("builtin-echo");
  });

  it("keeps mcpServers autoStart (not a secret) when sanitizing", () => {
    const sanitized = sanitizeConfigForClient({
      mcpServers: { blender: { transport: "stdio", command: "uvx", env: { K: "v" }, autoStart: false } },
    });
    expect(sanitized.mcpServers?.blender).toMatchObject({ autoStart: false });
    expect(sanitized.mcpServers?.blender).not.toHaveProperty("env");
  });

  it("strips mcpServers env/headers entirely instead of masking them", () => {
    const config = mergeConfig(
      {},
      {
        mcpServers: {
          fs: { transport: "stdio", command: "npx", args: ["-y", "server-fs"], env: { API_KEY: "secret" } },
          remote: { transport: "http", url: "https://mcp.example.com", headers: { Authorization: "Bearer x" } },
        },
      },
    );
    const sanitized = sanitizeConfigForClient(config);
    expect(sanitized.mcpServers?.fs).toEqual({ transport: "stdio", command: "npx", args: ["-y", "server-fs"] });
    expect(sanitized.mcpServers?.remote).toEqual({ transport: "http", url: "https://mcp.example.com" });
  });

  it("masks a connector's refreshToken same as a channel's token/botToken, and passes through non-secret account fields", () => {
    const config = mergeConfig(
      {},
      {
        connectors: {
          google: {
            enabled: true,
            accounts: {
              default: { refreshToken: "1//abc-real-refresh-token", scopes: ["calendar.events"], connectedAt: 123 },
            },
          },
        },
      },
    );

    const sanitized = sanitizeConfigForClient(config);
    const account = (sanitized.connectors?.google?.accounts as { default: Record<string, unknown> })?.default;
    expect(account?.refreshToken).toBe("***");
    expect(account?.scopes).toEqual(["calendar.events"]);
    expect(account?.connectedAt).toBe(123);
  });

  it("preserves the configured language (Settings needs to display it back)", () => {
    const config = mergeConfig({}, { language: "Spanish" });
    const sanitized = sanitizeConfigForClient(config);
    expect(sanitized.language).toBe("Spanish");
  });
});
