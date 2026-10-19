import { describe, it, expect, beforeEach } from "vitest";
import { clearToolRegistry, executeTool, registerToolDefinition } from "./registry.js";
import { defineTool } from "@yggdrasil/tools-sdk";

describe("tools-runtime registry", () => {
  beforeEach(() => {
    clearToolRegistry();
  });

  it("executes registered tool", async () => {
    registerToolDefinition(
      defineTool({
        name: "add",
        description: "add numbers",
        parameters: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
        },
        async execute(_ctx, args) {
          return Number(args.a) + Number(args.b);
        },
      }),
    );

    const result = await executeTool("add", { a: 2, b: 3 }, { sessionKey: "s", config: {} });
    expect(result).toBe(5);
  });
});
