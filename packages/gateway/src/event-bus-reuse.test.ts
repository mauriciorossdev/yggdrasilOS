import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_CONFIG } from "@yggdrasil/config";
import { definePlugin } from "@yggdrasil/sdk";
import { bootstrapKernel, disposeKernel, resetKernelForTest } from "@yggdrasil/kernel";
import { createDefaultGatewayContext } from "./methods.js";

// Regression for notes/automation/workflows-design.md §10.2 question 6: a
// plugin's `register(api)` used to get a DIFFERENT EventBus than the one
// server.ts actually forwards to connected WS clients — anything a plugin
// emitted on `api.events` outside a gateway-method call's own per-request
// `ctx.events` (e.g. a Scheduler or event-trigger subscription, set up once
// at register(api) time with no per-call ctx available) silently
// dead-lettered. This proves the real fix end to end: after bootstrapKernel,
// createDefaultGatewayContext's own `.events` must be the SAME instance a
// plugin already received as `api.events`.
describe("gateway context reuses the kernel's EventBus", () => {
  afterEach(async () => {
    await disposeKernel();
    resetKernelForTest();
  });

  it("createDefaultGatewayContext().events is the same instance as a bootstrapped plugin's api.events", async () => {
    let capturedEvents: unknown;
    const plugin = definePlugin({
      id: "event-bus-capture-plugin",
      register(api) {
        capturedEvents = api.events;
      },
    });

    await bootstrapKernel({
      config: { ...DEFAULT_CONFIG, plugins: { load: { paths: [] } } },
      workspaceRoot: process.cwd(),
      bundledPlugins: [plugin],
    });

    const ctx = await createDefaultGatewayContext(DEFAULT_CONFIG);
    expect(capturedEvents).toBeDefined();
    expect(ctx.events).toBe(capturedEvents);
  });

  it("falls back to a fresh EventBus when no kernel was bootstrapped (unchanged pre-existing behavior)", async () => {
    const ctx = await createDefaultGatewayContext(DEFAULT_CONFIG);
    expect(ctx.events).toBeDefined();
  });
});
