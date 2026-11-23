import { describe, expect, it, vi } from "vitest";

vi.mock("./terminalPanesStore.js", () => ({ requestFocusPane: vi.fn() }));

const { agoParts, pendingItems } = await import("./attentionStore.js");

describe("pendingItems", () => {
  it("lists waiting oldest first, then done newest first, only for live panes", () => {
    const states = {
      a: { status: "waiting" as const, since: 30 },
      b: { status: "waiting" as const, since: 10 },
      c: { status: "done" as const, since: 5 },
      d: { status: "done" as const, since: 50 },
      e: { status: "working" as const, since: 1 },
      gone: { status: "waiting" as const, since: 1 },
    };
    const { waiting, done } = pendingItems(states, new Set(["a", "b", "c", "d", "e"]));
    expect(waiting.map((i) => i.id)).toEqual(["b", "a"]);
    expect(done.map((i) => i.id)).toEqual(["d", "c"]);
  });
});

describe("agoParts", () => {
  it("rounds to now, minutes or hours", () => {
    expect(agoParts(0, 30_000)).toEqual({ key: "attn.ago.now", n: 0 });
    expect(agoParts(0, 5 * 60_000)).toEqual({ key: "attn.ago.min", n: 5 });
    expect(agoParts(0, 130 * 60_000)).toEqual({ key: "attn.ago.hour", n: 2 });
  });
});
