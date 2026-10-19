import { describe, it, expect } from "vitest";
import { runHeadless, truncate, extractReply } from "./headless-run.js";

describe("runHeadless", () => {
  it("resolves with stdout/exitCode for a normal short-lived process", async () => {
    const result = await runHeadless("node", ["-e", "process.stdout.write('hi')"], { timeoutMs: 5000 });
    expect(result).toEqual({ stdout: "hi", stderr: "", exitCode: 0, timedOut: false });
  });

  it("kills the process and resolves timedOut:true when it runs past timeoutMs", async () => {
    const result = await runHeadless("node", ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  // The fork-added feature: workflows.cancel needs to actually kill the
  // subprocess, not just stop the caller from waiting on it.
  it("kills the process when the passed AbortSignal fires, without marking it as a timeout", async () => {
    const controller = new AbortController();
    const resultPromise = runHeadless("node", ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 60_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    const result = await resultPromise;
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).not.toBe(0);
  }, 10_000);

  it("does not throw or hang when the signal is already aborted before the process even starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runHeadless("node", ["-e", "process.stdout.write('late')"], { timeoutMs: 5000, signal: controller.signal });
    expect(result).toBeDefined();
  }, 10_000);
});

describe("truncate", () => {
  it("leaves short text untouched", () => {
    expect(truncate("hello")).toEqual({ text: "hello", truncated: false });
  });

  it("truncates text over the cap and reports it", () => {
    const big = "x".repeat(25_000);
    const result = truncate(big);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(20_000);
  });
});

describe("extractReply", () => {
  it("extracts the first recognized field from JSON stdout", () => {
    expect(extractReply(JSON.stringify({ result: "the reply" }))).toEqual({ reply: "the reply", parsed: { result: "the reply" } });
  });

  it("falls back to the raw trimmed text when stdout isn't JSON", () => {
    expect(extractReply("  plain text  \n")).toEqual({ reply: "plain text" });
  });

  it("returns an empty reply for empty stdout", () => {
    expect(extractReply("   ")).toEqual({ reply: "" });
  });
});
