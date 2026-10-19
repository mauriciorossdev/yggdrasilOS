import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import { bootstrapKernel, resetKernelForTest, resetRegistryForTest } from "@yggdrasil/kernel";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { resetSessionStoreForTest } from "@yggdrasil/sessions";
import { invokeAgentTool } from "./invoke-agent-tool.js";

describe("invoke_agent tool", () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    resetRegistryForTest();
    resetKernelForTest();
    resetSessionStoreForTest();
    registerBuiltinHarnesses();
    workspaceRoot = await mkdtemp(join(tmpdir(), "ygg-invoke-agent-"));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("declares itself safe (no approval friction for delegation itself)", () => {
    expect(invokeAgentTool.riskLevel).toBe("safe");
    expect(invokeAgentTool.requiresApproval).toBeUndefined();
  });

  it("rejects a missing agentId", async () => {
    await bootstrapKernel({ config: DEFAULT_CONFIG, workspaceRoot });
    await expect(invokeAgentTool.execute({ sessionKey: "s", config: {} }, { message: "hi" })).rejects.toThrow(
      /agentId is required/,
    );
  });

  it("rejects a missing message", async () => {
    await bootstrapKernel({ config: DEFAULT_CONFIG, workspaceRoot });
    await expect(invokeAgentTool.execute({ sessionKey: "s", config: {} }, { agentId: "helper" })).rejects.toThrow(
      /message is required/,
    );
  });

  it("returns a clear error for an unknown agentId instead of silently falling back", async () => {
    const config = mergeConfig(DEFAULT_CONFIG, { agents: [{ id: "default", provider: "builtin", model: "echo" }] });
    await bootstrapKernel({ config, workspaceRoot });

    const result = await invokeAgentTool.execute({ sessionKey: "s", config: {} }, { agentId: "nope", message: "hi" });
    expect(result).toMatchObject({ delegated: false, error: expect.stringContaining('"nope"') });
  });

  it("delegates to another configured agent and returns its reply", async () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      agents: [
        { id: "orchestrator", provider: "builtin", model: "echo" },
        { id: "helper", provider: "builtin", model: "echo" },
      ],
    });
    await bootstrapKernel({ config, workspaceRoot });

    const result = (await invokeAgentTool.execute(
      { sessionKey: "desktop:default:orchestrator-session", config: {} },
      { agentId: "helper", message: "sub task" },
    )) as { delegated: boolean; agentId: string; reply: string; harnessId: string };

    expect(result.delegated).toBe(true);
    expect(result.agentId).toBe("helper");
    expect(result.reply).toBe("echo: sub task");
    expect(result.harnessId).toBe("builtin-echo");
  });

  it("refuses once the delegation depth cap is reached, without throwing", async () => {
    const config = mergeConfig(DEFAULT_CONFIG, { agents: [{ id: "helper", provider: "builtin", model: "echo" }] });
    await bootstrapKernel({ config, workspaceRoot });

    const deepSessionKey = "root::sub:a:1::sub:b:2::sub:c:3";
    const result = await invokeAgentTool.execute(
      { sessionKey: deepSessionKey, config: {} },
      { agentId: "helper", message: "hi" },
    );
    expect(result).toMatchObject({ delegated: false, error: expect.stringContaining("Delegation depth limit") });
  });

  describe("Agent Flow edge scoping (ctx.metadata.agentFlowEdges)", () => {
    // Full multi-hop self-propagation (target's own invoke_agent calls being
    // scoped in turn) is exercised at the manual end-to-end level per the
    // Agent Flow plan — the builtin echo harness used here never calls tools
    // itself, so a real second hop can't be driven from inside a unit test.
    // These tests cover what's unit-testable: enforcement, passthrough when
    // absent, guardrail composition with the depth cap, and event emission.

    async function bootstrapThreeAgents() {
      const config = mergeConfig(DEFAULT_CONFIG, {
        agents: [
          { id: "orchestrator", provider: "builtin", model: "echo" },
          { id: "researcher", provider: "builtin", model: "echo" },
          { id: "outsider", provider: "builtin", model: "echo" },
        ],
      });
      await bootstrapKernel({ config, workspaceRoot });
    }

    it("stays unscoped (today's behavior) when agentFlowEdges is absent from metadata", async () => {
      await bootstrapThreeAgents();
      const result = await invokeAgentTool.execute(
        { sessionKey: "s", config: {}, metadata: { agentId: "orchestrator" } },
        { agentId: "outsider", message: "hi" },
      );
      expect(result).toMatchObject({ delegated: true, agentId: "outsider" });
    });

    it("allows a target reachable via the caller's outgoing edges", async () => {
      await bootstrapThreeAgents();
      const result = await invokeAgentTool.execute(
        {
          sessionKey: "s",
          config: {},
          metadata: { agentId: "orchestrator", agentFlowEdges: { orchestrator: ["researcher"] } },
        },
        { agentId: "researcher", message: "what is 2+2" },
      );
      expect(result).toMatchObject({ delegated: true, agentId: "researcher", reply: "echo: what is 2+2" });
    });

    it("refuses a target not reachable via the caller's outgoing edges, without throwing", async () => {
      await bootstrapThreeAgents();
      const result = await invokeAgentTool.execute(
        {
          sessionKey: "s",
          config: {},
          metadata: { agentId: "orchestrator", agentFlowEdges: { orchestrator: ["researcher"] } },
        },
        { agentId: "outsider", message: "hi" },
      );
      expect(result).toMatchObject({
        delegated: false,
        error: expect.stringMatching(/not reachable from "orchestrator"/),
      });
    });

    it("still enforces the depth cap even when the target is edge-reachable", async () => {
      await bootstrapThreeAgents();
      const deepSessionKey = "root::sub:a:1::sub:b:2::sub:c:3";
      const result = await invokeAgentTool.execute(
        {
          sessionKey: deepSessionKey,
          config: {},
          metadata: { agentId: "orchestrator", agentFlowEdges: { orchestrator: ["researcher"] } },
        },
        { agentId: "researcher", message: "hi" },
      );
      expect(result).toMatchObject({ delegated: false, error: expect.stringContaining("Delegation depth limit") });
    });

    it("emits agentflow.delegate.start and chat.final on the provided event bus", async () => {
      await bootstrapThreeAgents();
      const emitted: Array<{ event: string; payload: unknown }> = [];
      const events = {
        on: () => () => {},
        off: () => {},
        emit: async (event: string, payload: unknown) => {
          emitted.push({ event, payload });
        },
      };

      const result = (await invokeAgentTool.execute(
        {
          sessionKey: "root",
          config: {},
          metadata: { agentId: "orchestrator", agentFlowEdges: { orchestrator: ["researcher"] } },
          events,
        },
        { agentId: "researcher", message: "hi" },
      )) as { delegated: boolean };
      expect(result.delegated).toBe(true);

      const start = emitted.find((e) => e.event === "agentflow.delegate.start");
      expect(start?.payload).toMatchObject({ parentSessionKey: "root", agentId: "researcher" });
      const subSessionKey = (start?.payload as { subSessionKey: string }).subSessionKey;
      expect(subSessionKey).toMatch(/^root::sub:researcher:/);

      const final = emitted.find((e) => e.event === "chat.final");
      expect(final?.payload).toMatchObject({ sessionKey: subSessionKey, text: "echo: hi" });
    });
  });
});
