import { describe, it, expect, beforeEach } from "vitest";
import { ContextCache } from "./cache.js";

describe("ContextCache", () => {
  let cache: ContextCache;

  beforeEach(() => {
    cache = new ContextCache();
  });

  it("returns null for missing keys", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("stores and retrieves blocks", () => {
    const blocks = [{ role: "system" as const, content: "hello", source: "test", priority: 0 }];
    cache.set("key1", blocks, 60_000);
    expect(cache.get("key1")).toEqual(blocks);
  });

  it("expires after TTL", () => {
    const blocks = [{ role: "system" as const, content: "hello", source: "test", priority: 0 }];
    cache.set("key1", blocks, -1);
    expect(cache.get("key1")).toBeNull();
  });

  it("invalidates by provider prefix", () => {
    cache.set("prompt-files:agent1:sess1", [{ role: "system", content: "a", source: "prompt-files", priority: 0 }], 60_000);
    cache.set("prompt-files:agent2:sess2", [{ role: "system", content: "b", source: "prompt-files", priority: 0 }], 60_000);
    cache.set("memory-db:agent1:sess1", [{ role: "system", content: "c", source: "memory-db", priority: 20 }], 60_000);

    cache.invalidate("prompt-files");

    expect(cache.get("prompt-files:agent1:sess1")).toBeNull();
    expect(cache.get("prompt-files:agent2:sess2")).toBeNull();
    expect(cache.get("memory-db:agent1:sess1")).not.toBeNull();
  });

  it("clear removes everything", () => {
    cache.set("k1", [{ role: "system", content: "a", source: "t", priority: 0 }], 60_000);
    cache.set("k2", [{ role: "system", content: "b", source: "t", priority: 0 }], 60_000);
    cache.clear();
    expect(cache.get("k1")).toBeNull();
    expect(cache.get("k2")).toBeNull();
  });
});
