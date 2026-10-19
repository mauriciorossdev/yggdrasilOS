import { describe, it, expect, beforeAll } from "vitest";
import type { GatewayHandler, YggdrasilPluginApi } from "@yggdrasil/sdk";
import plugin, { getSystemDocsPath } from "./index.js";

function noop(): void {}

function makeFakeApi(): { api: YggdrasilPluginApi; methods: Map<string, GatewayHandler> } {
  const methods = new Map<string, GatewayHandler>();
  const api: YggdrasilPluginApi = {
    pluginId: "context-system-docs",
    config: {},
    globalConfig: {},
    logger: { info: noop, warn: noop, error: noop, debug: noop } as unknown as YggdrasilPluginApi["logger"],
    events: { emit: noop, on: noop, off: noop } as unknown as YggdrasilPluginApi["events"],
    registerHarness: noop,
    registerChannel: noop,
    registerProvider: noop,
    registerTool: noop,
    registerGatewayMethod(name, handler) {
      methods.set(name, handler);
    },
    registerService: noop,
    registerContextProvider: noop,
    registerSkillCommand: noop,
  };
  return { api, methods };
}

const fakeCtx = { config: {}, events: {} as never, logger: { info: noop, warn: noop, error: noop, debug: noop } as never };

describe("context-system-docs plugin", () => {
  let methods: Map<string, GatewayHandler>;

  beforeAll(() => {
    const { api, methods: m } = makeFakeApi();
    methods = m;
    plugin.register(api);
  });

  it("registers docs.get and docs.list", () => {
    expect(methods.has("docs.get")).toBe(true);
    expect(methods.has("docs.list")).toBe(true);
  });

  it("docs.list returns the real system docs sorted, without .md extension", async () => {
    const handler = methods.get("docs.list")!;
    const result = (await handler({}, fakeCtx)) as { docs: string[] };
    expect(result.docs.length).toBeGreaterThan(0);
    expect(result.docs).toContain("tui");
    expect(result.docs.every((d) => !d.endsWith(".md"))).toBe(true);
    expect([...result.docs].sort()).toEqual(result.docs);
  });

  it("docs.get returns the content of a real doc", async () => {
    const handler = methods.get("docs.get")!;
    const result = (await handler({ name: "tui" }, fakeCtx)) as { name: string; content: string };
    expect(result.name).toBe("tui");
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("docs.get sanitizes the name to prevent path traversal", async () => {
    const handler = methods.get("docs.get")!;
    await expect(handler({ name: "../../../etc/passwd" }, fakeCtx)).rejects.toThrow();
  });

  it("docs.get requires a name", async () => {
    const handler = methods.get("docs.get")!;
    await expect(handler({}, fakeCtx)).rejects.toThrow(/name required/);
  });

  it("getSystemDocsPath points at a real, existing docs directory", async () => {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(getSystemDocsPath());
    expect(files.length).toBeGreaterThan(0);
  });
});
