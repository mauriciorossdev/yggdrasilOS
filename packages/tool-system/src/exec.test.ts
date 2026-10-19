import { describe, it, expect } from "vitest";
import { execAsync, EXEC_OPTS } from "./exec.js";

describe("execAsync", () => {
  it("resolves stdout for a successful command", async () => {
    const { stdout } = await execAsync("echo test-exec", EXEC_OPTS);
    expect(stdout.trim()).toBe("test-exec");
  });

  it("rejects for a failing command", async () => {
    await expect(execAsync("exit 1", EXEC_OPTS)).rejects.toThrow();
  });
});
