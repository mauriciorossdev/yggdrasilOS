import { describe, it, expect } from "vitest";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import { systemInfoTool } from "./system-info.js";

const ctx: ToolContext = { sessionKey: "test", config: {} };

describe("system_info tool", () => {
  it("returns the expected shape with real OS values", async () => {
    const result = (await systemInfoTool.execute(ctx, {})) as {
      platform: string;
      arch: string;
      cpuCount: number;
      totalMemBytes: number;
      nodeVersion: string;
    };

    expect(result.platform).toBe(process.platform);
    expect(result.arch).toBe(process.arch);
    expect(result.cpuCount).toBeGreaterThan(0);
    expect(result.totalMemBytes).toBeGreaterThan(0);
    expect(result.nodeVersion).toBe(process.version);
  });
});
