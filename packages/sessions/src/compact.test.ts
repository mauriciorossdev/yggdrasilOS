import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "@yggdrasil/config";
import {
  compactSummarize,
  compactTruncate,
  maybeCompactSession,
  shouldCompact,
} from "./compact.js";
import { SessionStore } from "./store.js";

describe("compact", () => {
  it("shouldCompact respects compactThreshold", () => {
    const config = mergeConfig(DEFAULT_CONFIG, { sessions: { compactThreshold: 5 } });
    expect(shouldCompact(4, config)).toBe(false);
    expect(shouldCompact(5, config)).toBe(true);
  });

  it("compactTruncate keeps last N messages", () => {
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: "user" as const,
      content: `m${i}`,
      timestamp: i,
    }));
    const kept = compactTruncate(messages, 3);
    expect(kept).toHaveLength(3);
    expect(kept[0]?.content).toBe("m5");
  });

  it("compactSummarize prepends system summary", async () => {
    const messages = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${i}`,
      timestamp: i,
    }));
    const result = await compactSummarize(messages, {
      keepRecent: 4,
      summarize: async () => "resumen corto",
    });
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("resumen corto");
    expect(result).toHaveLength(5);
  });
});

describe("maybeCompactSession", () => {
  let dir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "yggdrasil-compact-"));
    store = new SessionStore(dir, 50);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("truncates when summarize unavailable", async () => {
    const sessionKey = "compact:truncate";
    const config = mergeConfig(DEFAULT_CONFIG, {
      sessions: { compactThreshold: 5, compactionPolicy: "truncate", maxMessages: 50 },
    });

    for (let i = 0; i < 6; i++) {
      await store.appendUser(sessionKey, `u${i}`);
    }

    const history = await maybeCompactSession({ sessionKey, store, config });
    const record = await store.get(sessionKey);
    expect(record?.messages.length).toBeLessThanOrEqual(10);
    expect(record?.compaction?.lastCompactedAt).toBeDefined();
    expect(history.length).toBeLessThan(6);
  });
});
