import { describe, it, expect } from "vitest";
import { resolveShellInvocation, runLocalCommand } from "./run-local-command.js";

describe("resolveShellInvocation", () => {
  it("uses powershell.exe on win32", () => {
    const result = resolveShellInvocation("win32", "echo hi");
    expect(result).toEqual({ file: "powershell.exe", args: ["-NoProfile", "-Command", "echo hi"] });
  });

  it("uses $SHELL (or /bin/sh) with -c on posix platforms", () => {
    const result = resolveShellInvocation("linux", "echo hi");
    expect(result.args).toEqual(["-c", "echo hi"]);
    expect(result.file).toBe(process.env.SHELL || "/bin/sh");
  });

  it("treats darwin the same as linux", () => {
    const result = resolveShellInvocation("darwin", "echo hi");
    expect(result.args).toEqual(["-c", "echo hi"]);
  });
});

describe("runLocalCommand", () => {
  const isWin = process.platform === "win32";
  const echoCmd = isWin ? "Write-Output hello" : "echo hello";
  const failCmd = isWin ? "exit 3" : "exit 3";
  const stderrCmd = isWin ? "[Console]::Error.WriteLine('oops')" : "echo oops 1>&2";

  it("captures stdout and a zero exit code on success", async () => {
    const result = await runLocalCommand(echoCmd, process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  it("captures a non-zero exit code", async () => {
    const result = await runLocalCommand(failCmd, process.cwd());
    expect(result.exitCode).toBe(3);
  });

  it("captures stderr output", async () => {
    const result = await runLocalCommand(stderrCmd, process.cwd());
    expect(result.stderr.trim()).toBe("oops");
  });

  it("reports a spawn/command failure without throwing", async () => {
    const result = await runLocalCommand("this-command-does-not-exist-xyz", process.cwd());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it("truncates very large output", async () => {
    const bigCmd = isWin
      ? "Write-Output ('x' * 25000)"
      : "yes x | head -c 25000";
    const result = await runLocalCommand(bigCmd, process.cwd());
    expect(result.stdout).toContain("truncated");
    expect(result.stdout.length).toBeLessThan(25000);
  });
});
