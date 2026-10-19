import { describe, it, expect } from "vitest";
import type { ToolContext } from "@yggdrasil/tools-sdk";
import { runCommandTool } from "./shell.js";

const ctx: ToolContext = { sessionKey: "test", config: {} };

describe("run_command tool", () => {
  it("returns stdout and exitCode 0 for a successful command", async () => {
    const result = (await runCommandTool.execute(ctx, { command: "echo hello" })) as {
      stdout: string;
      exitCode: number;
    };
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("returns a non-zero exitCode and stderr for a failing command", async () => {
    const result = (await runCommandTool.execute(ctx, {
      command: "echo boom 1>&2; exit 2",
    })) as { stderr: string; exitCode: number };
    expect(result.exitCode).toBe(2);
    expect(result.stderr.trim()).toBe("boom");
  });

  it("respects a custom cwd", async () => {
    const result = (await runCommandTool.execute(ctx, { command: "pwd", cwd: "/tmp" })) as {
      stdout: string;
    };
    expect(result.stdout.trim().endsWith("/tmp")).toBe(true);
  });

  it("truncates stdout beyond MAX_OUTPUT", async () => {
    const result = (await runCommandTool.execute(ctx, {
      command: "yes | head -c 25000",
    })) as { stdout: string; stdoutTruncated: boolean };
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBe(20_000);
  });
});
