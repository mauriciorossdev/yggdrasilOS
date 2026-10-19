import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_CONFIG } from "@yggdrasil/config";
import { definePlugin, type AgentHarness, type EventBus } from "@yggdrasil/sdk";
import { bootstrapKernel, disposeKernel, getKernelContext, resetKernelForTest } from "./lifecycle.js";
import { getHarness, resetRegistryForTest } from "./registry.js";

describe("kernel plugin registration", () => {
  beforeEach(() => {
    resetRegistryForTest();
    resetKernelForTest();
  });

  it("registers a harness from a bundled plugin", async () => {
    const mockHarness: AgentHarness = {
      id: "mock",
      label: "Mock",
      supports: () => ({ supported: true, priority: 50 }),
      runAttempt: async () => ({ text: "mock reply" }),
    };

    const plugin = definePlugin({
      id: "mock-plugin",
      register(api) {
        api.registerHarness(mockHarness);
      },
    });

    await bootstrapKernel({
      config: { ...DEFAULT_CONFIG, plugins: { load: { paths: [] } } },
      workspaceRoot: process.cwd(),
      bundledPlugins: [plugin],
    });

    expect(getHarness("mock")).toBeDefined();
    expect(getHarness("mock")?.harness.label).toBe("Mock");
    await disposeKernel();
  });

  // Regression for a real bug found while debugging phase 6's phone.tool
  // (notes/automation/workflows-design.md §10.2 question 6): loadPlugins
  // used to always mint its OWN EventBus for every plugin's `api.events`,
  // separate from whatever the host process built its gateway's own
  // broadcast bus from — a plugin that emitted on `api.events` outside a
  // gateway-method call's per-request `ctx.events` (e.g. a Scheduler set up
  // once at register(api) time, no per-call ctx available) silently
  // dead-lettered: nothing forwarded from that second, disconnected bus.
  // KernelContext.events is the fix — the one bus every plugin's
  // register(api) call actually receives, now exposed so a later consumer
  // (packages/gateway/src/methods.ts's createDefaultGatewayContext) can
  // reuse the SAME instance instead of creating its own.
  it("exposes the one EventBus every plugin's register(api) call receives, via getKernelContext()", async () => {
    let capturedEvents: EventBus | undefined;
    const plugin = definePlugin({
      id: "event-capture-plugin",
      register(api) {
        capturedEvents = api.events;
      },
    });

    await bootstrapKernel({
      config: { ...DEFAULT_CONFIG, plugins: { load: { paths: [] } } },
      workspaceRoot: process.cwd(),
      bundledPlugins: [plugin],
    });

    expect(capturedEvents).toBeDefined();
    expect(getKernelContext()?.events).toBe(capturedEvents);
    await disposeKernel();
  });
});
