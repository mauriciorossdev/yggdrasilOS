import { describe, it, expect } from "vitest";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { YggdrasilPluginApi } from "@yggdrasil/sdk";
import plugin from "./index.js";

function noop(): void {}

function registerPlugin(): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = [];
  const api: YggdrasilPluginApi = {
    pluginId: "tool-weather",
    config: {},
    globalConfig: {},
    logger: { info: noop, warn: noop, error: noop, debug: noop } as unknown as YggdrasilPluginApi["logger"],
    events: { emit: noop, on: noop, off: noop } as unknown as YggdrasilPluginApi["events"],
    registerHarness: noop,
    registerChannel: noop,
    registerProvider: noop,
    registerTool(tool) {
      if (typeof tool !== "function") tools.push(tool);
    },
    registerGatewayMethod: noop,
    registerService: noop,
    registerContextProvider: noop,
    registerSkillCommand: noop,
  };
  plugin.register(api);
  return tools;
}

describe("tool-weather plugin", () => {
  it("registers the get_weather tool", () => {
    const tools = registerPlugin();
    expect(tools.map((t) => t.name)).toEqual(["get_weather"]);
  });

  it("get_weather returns mock weather for the given city", async () => {
    const tools = registerPlugin();
    const tool = tools.find((t) => t.name === "get_weather")!;
    const result = (await tool.execute({ sessionKey: "s1", config: {} }, { city: "Bariloche" })) as {
      city: string;
      tempC: number;
      condition: string;
    };
    expect(result).toEqual({ city: "Bariloche", tempC: 22, condition: "sunny" });
  });

  it("defaults to 'unknown' when no city is given", async () => {
    const tools = registerPlugin();
    const tool = tools.find((t) => t.name === "get_weather")!;
    const result = (await tool.execute({ sessionKey: "s1", config: {} }, {})) as { city: string };
    expect(result.city).toBe("unknown");
  });
});
