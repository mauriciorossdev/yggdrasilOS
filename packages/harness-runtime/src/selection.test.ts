import { describe, it, expect, beforeEach } from "vitest";
import type { AgentHarness } from "@yggdrasil/sdk";
import type { YggdrasilConfig } from "@yggdrasil/config";
import { registerHarness, resetRegistryForTest } from "@yggdrasil/kernel";
import { selectHarness } from "./selection.js";
import { BUILTIN_ECHO_HARNESS_ID } from "./builtin/echo.js";

function makeHarness(id: string, priority: number): AgentHarness {
  return {
    id,
    label: id,
    supports: () => ({ supported: true, priority }),
    runAttempt: async () => ({ text: `${id} reply` }),
  };
}

function makeUnsupportedHarness(id: string): AgentHarness {
  return {
    id,
    label: id,
    supports: () => ({ supported: false, reason: "not applicable" }),
    runAttempt: async () => ({ text: `${id} reply` }),
  };
}

const baseCtx = { provider: "openai-compat", modelId: "gpt-4o-mini" };

describe("selectHarness", () => {
  beforeEach(() => {
    resetRegistryForTest();
  });

  it("returns the pinned harness when policy is pinned and it is registered", () => {
    registerHarness(makeHarness("pinned-one", 10));
    const config: YggdrasilConfig = { harness: { policy: "pinned", pinnedId: "pinned-one" } };

    const result = selectHarness({ ...baseCtx, config });

    expect(result.reason).toBe("pinned");
    expect(result.harnessId).toBe("pinned-one");
    expect(result.candidates).toEqual([{ id: "pinned-one", priority: Infinity, supported: true }]);
  });

  it("falls back to auto selection when the pinned harness is not registered", () => {
    registerHarness(makeHarness("only-one", 5));
    const config: YggdrasilConfig = { harness: { policy: "pinned", pinnedId: "missing-id" } };

    const result = selectHarness({ ...baseCtx, config });

    expect(result.reason).not.toBe("pinned");
    expect(result.harnessId).toBe("only-one");
  });

  it("picks the highest-priority supported harness under auto policy", () => {
    registerHarness(makeHarness("low", 1));
    registerHarness(makeHarness("high", 100));
    const config: YggdrasilConfig = { harness: { policy: "auto" } };

    const result = selectHarness({ ...baseCtx, config });

    expect(result.harnessId).toBe("high");
    expect(result.reason).toBe("auto_plugin");
  });

  it("falls back to the builtin echo harness when nothing is supported", () => {
    registerHarness(makeUnsupportedHarness("nope-a"));
    registerHarness(makeUnsupportedHarness("nope-b"));
    const config: YggdrasilConfig = { harness: { policy: "auto" } };

    const result = selectHarness({ ...baseCtx, config });

    expect(result.harnessId).toBe(BUILTIN_ECHO_HARNESS_ID);
    expect(result.reason).toBe("auto_builtin");
  });

  it("falls back to the builtin echo harness when nothing is registered at all", () => {
    const config: YggdrasilConfig = { harness: { policy: "auto" } };

    const result = selectHarness({ ...baseCtx, config });

    expect(result.harnessId).toBe(BUILTIN_ECHO_HARNESS_ID);
    expect(result.reason).toBe("auto_builtin");
    expect(result.candidates).toEqual([]);
  });

  it("marks unsupported candidates with priority -1 while still choosing a supported one", () => {
    registerHarness(makeUnsupportedHarness("nope"));
    registerHarness(makeHarness("yes", 7));
    const config: YggdrasilConfig = { harness: { policy: "auto" } };

    const result = selectHarness({ ...baseCtx, config });

    const nope = result.candidates.find((c) => c.id === "nope");
    expect(nope).toEqual({ id: "nope", priority: -1, supported: false, reason: "not applicable" });
    expect(result.harnessId).toBe("yes");
  });

  it("defaults to auto policy when harness config is absent", () => {
    registerHarness(makeHarness("solo", 1));
    const config: YggdrasilConfig = {};

    const result = selectHarness({ ...baseCtx, config });

    expect(result.harnessId).toBe("solo");
  });
});
