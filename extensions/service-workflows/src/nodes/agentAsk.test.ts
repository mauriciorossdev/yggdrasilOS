import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@yggdrasil/tool-cli-delegate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@yggdrasil/tool-cli-delegate")>();
  return { ...actual, runHeadless: vi.fn() };
});

import { runHeadless } from "@yggdrasil/tool-cli-delegate";
import { agentAskExecutor } from "./agentAsk.js";

function run(params: Record<string, unknown>, signal: AbortSignal = new AbortController().signal) {
  return agentAskExecutor({ node: {} as never, params, exprCtx: {} as never, signal, workflow: {} as never, nodeExecutors: {} });
}

function mockResult(overrides: Partial<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> = {}) {
  return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...overrides };
}

describe("agentAskExecutor", () => {
  beforeEach(() => {
    (runHeadless as unknown as Mock).mockReset();
  });

  it("throws when `prompt` is missing or blank", async () => {
    await expect(run({})).rejects.toThrow(/prompt/);
    await expect(run({ prompt: "   " })).rejects.toThrow(/prompt/);
    expect(runHeadless).not.toHaveBeenCalled();
  });

  it("defaults to the claude CLI with --permission-prompts none and a fresh --session-id", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: JSON.stringify({ result: "hi there" }) }));
    const result = await run({ prompt: "say hi" });

    const [cli, args] = (runHeadless as unknown as Mock).mock.calls[0]!;
    expect(cli).toBe("claude");
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--permission-prompts", "none", "say hi"]));
    expect(args).toContain("--session-id");
    expect(result).toEqual({ handle: "out", output: { provider: "claude", reply: "hi there", replyTruncated: false } });
  });

  it("maps provider \"agy\"/\"antigravity\" to the agy CLI with --mode plan, and no --session-id", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: JSON.stringify({ result: "ok" }) }));
    await run({ prompt: "task", provider: "antigravity" });

    const [cli, args] = (runHeadless as unknown as Mock).mock.calls[0]!;
    expect(cli).toBe("agy");
    expect(args).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--mode", "plan", "task"]));
    expect(args).not.toContain("--session-id");
  });

  it("passes model/effort through as flags when provided", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: "{}" }));
    await run({ prompt: "x", model: "claude-opus-5", effort: "high" });
    const [, args] = (runHeadless as unknown as Mock).mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(["--model", "claude-opus-5", "--effort", "high"]));
  });

  it("forwards cwd/timeoutMs/signal to runHeadless, with a 5 minute default timeout", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: "{}" }));
    const signal = new AbortController().signal;
    await agentAskExecutor({ node: {} as never, params: { prompt: "x", cwd: "/tmp/proj" }, exprCtx: {} as never, signal, workflow: {} as never, nodeExecutors: {} });
    const [, , opts] = (runHeadless as unknown as Mock).mock.calls[0]!;
    expect(opts).toEqual({ cwd: "/tmp/proj", timeoutMs: 5 * 60_000, signal });
  });

  it("throws when the CLI times out", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ timedOut: true }));
    await expect(run({ prompt: "x" })).rejects.toThrow(/timed out/);
  });

  it("throws with the CLI's stderr when it exits non-zero", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ exitCode: 1, stderr: "auth error" }));
    await expect(run({ prompt: "x" })).rejects.toThrow(/auth error/);
  });

  it("throws \"aborted\" if the signal was aborted even when the CLI otherwise reports success", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: "{}" }));
    const controller = new AbortController();
    controller.abort();
    await expect(run({ prompt: "x" }, controller.signal)).rejects.toThrow(/aborted/);
  });

  it("parses the reply as JSON when outputFormat is \"json\"", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: JSON.stringify({ result: JSON.stringify({ ok: true, n: 3 }) }) }));
    const result = await run({ prompt: "x", outputFormat: "json" });
    expect(result.output).toEqual({ provider: "claude", reply: { ok: true, n: 3 }, replyTruncated: false });
  });

  it("falls back to the raw text with jsonParseError:true when outputFormat is \"json\" but the reply isn't valid JSON", async () => {
    (runHeadless as unknown as Mock).mockResolvedValue(mockResult({ stdout: JSON.stringify({ result: "not json" }) }));
    const result = await run({ prompt: "x", outputFormat: "json" });
    expect(result.output).toEqual({ provider: "claude", reply: "not json", replyTruncated: false, jsonParseError: true });
  });
});
