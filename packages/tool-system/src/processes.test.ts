import { describe, it, expect } from "vitest";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import { listProcessesTool, listInstalledAppsTool } from "./processes.js";

const ctx: ToolContext = { sessionKey: "test", config: {} };

describe("list_processes tool", () => {
  it("returns a non-empty list of processes with the expected shape", async () => {
    const result = (await listProcessesTool.execute(ctx, {})) as {
      platform: string;
      processes: Array<Record<string, unknown>>;
    };
    expect(result.platform).toBe(process.platform);
    expect(Array.isArray(result.processes)).toBe(true);
    expect(result.processes.length).toBeGreaterThan(0);
    const first = result.processes[0]!;
    expect(first).toHaveProperty("pid");
    expect(first).toHaveProperty("name");
  });
});

describe("list_installed_apps tool", () => {
  it("returns apps for the current platform without throwing", async () => {
    const result = (await listInstalledAppsTool.execute(ctx, {})) as {
      platform: string;
      apps: Array<Record<string, unknown>>;
    };
    expect(result.platform).toBe(process.platform);
    expect(Array.isArray(result.apps)).toBe(true);
  });
});
