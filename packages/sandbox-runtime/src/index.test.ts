import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInSandbox, runShellInSandbox } from "./index.js";

describe("sandbox-runtime", () => {
  describe("resolveCwd (via runInSandbox)", () => {
    it("defaults to process.cwd() when no cwd given", async () => {
      const result = await runInSandbox({ command: "pwd" });
      expect(result.stdout.trim()).toBe(process.cwd());
      expect(result.exitCode).toBe(0);
    });

    it("rejects a cwd that does not exist", async () => {
      await expect(
        runInSandbox({ command: "pwd", cwd: join(tmpdir(), "does-not-exist-xyz") }),
      ).rejects.toThrow(/does not exist/);
    });

    it("rejects a cwd that is a file, not a directory", async () => {
      const dir = mkdtempSync(join(tmpdir(), "sandbox-test-"));
      const file = join(dir, "afile.txt");
      writeFileSync(file, "hi");
      try {
        await expect(runInSandbox({ command: "pwd", cwd: file })).rejects.toThrow(
          /does not exist or is not a directory/,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("allows a cwd inside allowedCwdRoot", async () => {
      const root = mkdtempSync(join(tmpdir(), "sandbox-root-"));
      try {
        const result = await runInSandbox({ command: "pwd", cwd: root, allowedCwdRoot: root });
        expect(realpathSync(result.stdout.trim())).toBe(realpathSync(root));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("rejects a cwd outside allowedCwdRoot", async () => {
      const root = mkdtempSync(join(tmpdir(), "sandbox-root-"));
      const outside = mkdtempSync(join(tmpdir(), "sandbox-outside-"));
      try {
        await expect(
          runInSandbox({ command: "pwd", cwd: outside, allowedCwdRoot: root }),
        ).rejects.toThrow(/outside allowed root/);
      } finally {
        rmSync(root, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe("env filtering", () => {
    const ORIGINAL_SECRET = process.env.SANDBOX_TEST_SECRET;

    afterEach(() => {
      if (ORIGINAL_SECRET === undefined) delete process.env.SANDBOX_TEST_SECRET;
      else process.env.SANDBOX_TEST_SECRET = ORIGINAL_SECRET;
    });

    it("does not leak arbitrary process.env vars into the child", async () => {
      process.env.SANDBOX_TEST_SECRET = "leaked-if-broken";
      const result = await runShellInSandbox("echo \"[$SANDBOX_TEST_SECRET]\"", {});
      expect(result.stdout.trim()).toBe("[]");
    });

    it("passes through explicit extra env vars", async () => {
      const result = await runShellInSandbox("echo \"$MY_CUSTOM_VAR\"", {
        env: { MY_CUSTOM_VAR: "hello-sandbox" },
      });
      expect(result.stdout.trim()).toBe("hello-sandbox");
    });

    it("keeps allowlisted vars like PATH", async () => {
      const result = await runShellInSandbox("echo \"$PATH\"", {});
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    });
  });

  describe("runInSandbox", () => {
    it("returns stdout and exitCode 0 for a successful command", async () => {
      const result = await runInSandbox({ command: "echo", args: ["hello"] });
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
    });

    it("reports a non-zero exitCode and stderr for a failing command", async () => {
      const result = await runShellInSandbox("echo oops 1>&2; exit 3", {});
      expect(result.exitCode).toBe(3);
      expect(result.stderr.trim()).toBe("oops");
    });

    it("resolves with exitCode null and an error message for a missing binary", async () => {
      const result = await runInSandbox({ command: "definitely-not-a-real-binary-xyz" });
      expect(result.exitCode).toBeNull();
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it("kills the process and reports timedOut on timeout", async () => {
      const result = await runShellInSandbox("sleep 5", { timeout: 100 });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
    }, 10_000);

    it("truncates stdout beyond maxBuffer without throwing", async () => {
      const result = await runShellInSandbox("yes | head -c 10000", { maxBuffer: 100 });
      expect(result.stdout.length).toBeLessThanOrEqual(100);
    });
  });

  describe("runShellInSandbox", () => {
    it("uses /bin/sh -c on non-windows platforms", async () => {
      if (process.platform === "win32") return;
      const result = await runShellInSandbox("echo shell-ok", {});
      expect(result.stdout.trim()).toBe("shell-ok");
    });
  });
});
