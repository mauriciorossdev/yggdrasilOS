import { describe, it, expect, beforeEach } from "vitest";
import { resolveContext } from "./resolve.js";
import { resetContextCacheForTest } from "./cache.js";
import { registerContextProvider, resetRegistryForTest } from "@yggdrasil/kernel";
import type { ContextProvider, ContextProviderContext } from "@yggdrasil/context-sdk";

function makeCtx(overrides?: Partial<ContextProviderContext>): ContextProviderContext {
  return {
    sessionKey: "sess-1",
    agentId: "default",
    workspaceRoot: "/tmp/test",
    config: {},
    globalConfig: {},
    ...overrides,
  };
}

describe("resolveContext", () => {
  beforeEach(() => {
    resetRegistryForTest();
    resetContextCacheForTest();
  });

  it("returns empty when no providers registered", async () => {
    const result = await resolveContext(makeCtx(), []);
    expect(result).toEqual([]);
  });

  it("assembles from registered provider", async () => {
    const provider: ContextProvider = {
      id: "test-provider",
      priority: 0,
      async assemble() {
        return [{ role: "system", content: "hello from test", source: "test-provider", priority: 0 }];
      },
    };
    registerContextProvider(provider);

    const result = await resolveContext(makeCtx(), ["test-provider"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("hello from test");
    expect(result[0]!.role).toBe("system");
  });

  it("sorts by priority", async () => {
    registerContextProvider({
      id: "low",
      async assemble() {
        return [{ role: "system", content: "low", source: "low", priority: 10 }];
      },
    });
    registerContextProvider({
      id: "high",
      async assemble() {
        return [{ role: "system", content: "high", source: "high", priority: 0 }];
      },
    });

    const result = await resolveContext(makeCtx(), ["low", "high"]);
    expect(result[0]!.content).toBe("high");
    expect(result[1]!.content).toBe("low");
  });

  it("filters by providerIds", async () => {
    registerContextProvider({
      id: "included",
      async assemble() {
        return [{ role: "system", content: "yes", source: "included", priority: 0 }];
      },
    });
    registerContextProvider({
      id: "excluded",
      async assemble() {
        return [{ role: "system", content: "no", source: "excluded", priority: 0 }];
      },
    });

    const result = await resolveContext(makeCtx(), ["included"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("yes");
  });

  it("respects token budget", async () => {
    registerContextProvider({
      id: "big",
      async assemble() {
        return [{ role: "system", content: "x".repeat(1000), source: "big", priority: 0, tokens: 500 }];
      },
    });
    registerContextProvider({
      id: "small",
      async assemble() {
        return [{ role: "system", content: "small", source: "small", priority: 1, tokens: 10 }];
      },
    });

    const result = await resolveContext(makeCtx(), ["big", "small"], 100);
    expect(result).toHaveLength(0);
  });

  it("handles provider failure gracefully", async () => {
    registerContextProvider({
      id: "failing",
      async assemble() {
        throw new Error("boom");
      },
    });
    registerContextProvider({
      id: "ok",
      async assemble() {
        return [{ role: "system", content: "works", source: "ok", priority: 0 }];
      },
    });

    const result = await resolveContext(makeCtx(), ["failing", "ok"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("works");
  });

  it("skips unsupported provider", async () => {
    registerContextProvider({
      id: "unsupported",
      supports() { return false; },
      async assemble() {
        return [{ role: "system", content: "nope", source: "unsupported", priority: 0 }];
      },
    });

    const result = await resolveContext(makeCtx(), ["unsupported"]);
    expect(result).toHaveLength(0);
  });
});
