import { describe, it, expect } from "vitest";
import type { AgentToolDefinition } from "@yggdrasil/tools-sdk";
import type { ContextProviderRegistration, YggdrasilPluginApi } from "@yggdrasil/sdk";
import { defineSkill, defineTool } from "./index.js";

function noop(): void {}

function makeFakeApi(): {
  api: YggdrasilPluginApi;
  tools: AgentToolDefinition[];
  providers: ContextProviderRegistration[];
} {
  const tools: AgentToolDefinition[] = [];
  const providers: ContextProviderRegistration[] = [];
  const api: YggdrasilPluginApi = {
    pluginId: "test",
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
    registerContextProvider(provider) {
      providers.push(provider);
    },
    registerSkillCommand: noop,
  };
  return { api, tools, providers };
}

describe("defineSkill", () => {
  it("registers no tools or context provider when the definition is bare", async () => {
    const plugin = defineSkill({ id: "bare-skill", name: "Bare Skill" });
    const { api, tools, providers } = makeFakeApi();
    await plugin.register(api);
    expect(tools).toHaveLength(0);
    expect(providers).toHaveLength(0);
    expect(plugin.version).toBe("0.1.0");
  });

  it("registers the given tools", async () => {
    const myTool = defineTool({
      name: "my_tool",
      description: "does something",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { ok: true };
      },
    });
    const plugin = defineSkill({ id: "tooled-skill", name: "Tooled Skill", tools: [myTool] });
    const { api, tools } = makeFakeApi();
    await plugin.register(api);
    expect(tools).toEqual([myTool]);
  });

  it("registers a context provider with the given instructions", async () => {
    const plugin = defineSkill({
      id: "instructed-skill",
      name: "Instructed Skill",
      instructions: "  Always be polite.  ",
    });
    const { api, providers } = makeFakeApi();
    await plugin.register(api);

    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe("instructed-skill:instructions");
    const blocks = await providers[0]!.assemble({} as never);
    expect(blocks[0]!.content).toBe("Always be polite.");
    expect(blocks[0]!.source).toBe("instructed-skill");
  });

  it("skips the context provider when instructions are blank", async () => {
    const plugin = defineSkill({ id: "blank-skill", name: "Blank Skill", instructions: "   " });
    const { api, providers } = makeFakeApi();
    await plugin.register(api);
    expect(providers).toHaveLength(0);
  });
});
