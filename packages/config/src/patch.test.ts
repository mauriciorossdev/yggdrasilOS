import { describe, it, expect } from "vitest";
import { validateConfigPatch } from "./patch.js";

describe("validateConfigPatch", () => {
  it("accepts allowed hot-reload keys", () => {
    const result = validateConfigPatch({
      defaultAgent: "default",
      harness: { policy: "pinned", pinnedId: "llm" },
      channels: { tui: { enabled: true } },
      auth: { gateway: { apiKeys: [{ key: "abc", name: "admin" }] } },
      pluginConfig: { "tool-shell": { allowedRoot: "/tmp" } },
      providers: { "openai-compat": { baseUrl: "http://localhost:11434/v1" } },
    });
    expect(result.patch.defaultAgent).toBe("default");
    expect(result.patch.harness?.pinnedId).toBe("llm");
    expect(result.patch.channels?.tui?.enabled).toBe(true);
    expect(result.hotReloadedKeys).toContain("auth");
    expect(result.hotReloadedKeys).toContain("pluginConfig");
    expect(result.restartRequiredKeys).toHaveLength(0);
  });

  it("marks sessions as restart-required", () => {
    const result = validateConfigPatch({ sessions: { maxMessages: 100 } });
    expect(result.restartRequiredKeys).toContain("sessions");
    expect(result.hotReloadedKeys).not.toContain("sessions");
  });

  it("rejects forbidden keys", () => {
    expect(() => validateConfigPatch({ plugins: { installed: ["x"] } })).toThrow(/forbidden keys/);
    expect(() => validateConfigPatch({ gateway: { port: 9000 } })).toThrow(/forbidden keys/);
  });

  it("accepts providers, only including fields actually sent (no explicit-undefined clobbering)", () => {
    const { patch } = validateConfigPatch({
      providers: { ollama: { baseUrl: "http://192.168.1.50:11434" } },
    });
    expect(patch.providers?.ollama).toEqual({ baseUrl: "http://192.168.1.50:11434" });
    expect(Object.keys(patch.providers?.ollama ?? {})).toEqual(["baseUrl"]);
  });

  it("accepts stdio mcpServers, only including env when actually sent", () => {
    const { patch } = validateConfigPatch({
      mcpServers: { fs: { transport: "stdio", command: "npx", args: ["-y", "server-fs"] } },
    });
    expect(patch.mcpServers?.fs).toEqual({ transport: "stdio", command: "npx", args: ["-y", "server-fs"] });
    expect(Object.keys(patch.mcpServers?.fs ?? {})).not.toContain("env");
  });

  it("accepts http mcpServers with headers", () => {
    const { patch } = validateConfigPatch({
      mcpServers: { remote: { transport: "http", url: "https://mcp.example.com", headers: { Authorization: "Bearer x" } } },
    });
    expect(patch.mcpServers?.remote).toEqual({
      transport: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("rejects an mcpServers entry with an unknown transport", () => {
    expect(() =>
      validateConfigPatch({ mcpServers: { bad: { transport: "sse" } } }),
    ).toThrow(/transport must be "stdio" or "http"/);
  });
});
