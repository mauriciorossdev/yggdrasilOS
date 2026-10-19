import { describe, it, expect, beforeEach } from "vitest";
import { pushTurnLog, getTurnLogSnapshot, clearTurnLog } from "./turn-log.js";

describe("turn-log", () => {
  beforeEach(() => {
    clearTurnLog();
  });

  it("stores and retrieves turn entries", () => {
    pushTurnLog({ sessionKey: "s1", harnessId: "llm", timestamp: 1000 });
    pushTurnLog({ sessionKey: "s2", harnessId: "echo", timestamp: 2000 });

    const snapshot = getTurnLogSnapshot();
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].sessionKey).toBe("s1");
    expect(snapshot[1].sessionKey).toBe("s2");
  });

  it("caps at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      pushTurnLog({ sessionKey: `s${i}`, timestamp: i });
    }

    const snapshot = getTurnLogSnapshot();
    expect(snapshot).toHaveLength(50);
    expect(snapshot[0].sessionKey).toBe("s10");
    expect(snapshot[49].sessionKey).toBe("s59");
  });
});
