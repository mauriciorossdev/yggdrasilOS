import { describe, it, expect } from "vitest";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import { datetimeTool, echoTool } from "./index.js";

const ctx: ToolContext = { sessionKey: "test", config: {} };

describe("datetime tool", () => {
  it("returns a valid ISO 8601 timestamp", async () => {
    const result = (await datetimeTool.execute(ctx, {})) as { iso: string };
    expect(new Date(result.iso).toISOString()).toBe(result.iso);
  });
});

describe("echo tool", () => {
  it("echoes back the given args unchanged", async () => {
    const args = { message: "hi there" };
    const result = (await echoTool.execute(ctx, args)) as { echoed: unknown };
    expect(result.echoed).toEqual(args);
  });
});
