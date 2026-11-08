import { describe, expect, it } from "vitest";
import { toChatMessages } from "./sessionMessages.js";

describe("toChatMessages", () => {
  it("keeps user/assistant/tool roles and folds the rest into system", () => {
    const out = toChatMessages([
      { role: "user", content: "hi", timestamp: 1 },
      { role: "assistant", content: "yo", timestamp: 2 },
      { role: "tool", content: "{}", timestamp: 3 },
      { role: "developer", content: "x", timestamp: 4 },
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "system"]);
    expect(out[0]).toMatchObject({ id: "resumed-0", text: "hi", timestamp: 1 });
  });

  it("fills a missing timestamp", () => {
    const [m] = toChatMessages([{ role: "user", content: "hi" }]);
    expect(typeof m!.timestamp).toBe("number");
  });
});
