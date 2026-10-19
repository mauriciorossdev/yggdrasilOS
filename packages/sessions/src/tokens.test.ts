import { describe, it, expect } from "vitest";
import {
  estimateHistoryTokens,
  estimateMessageTokens,
  trimHistoryToTokenBudget,
} from "./tokens.js";

describe("tokens", () => {
  it("estimates tokens from content length", () => {
    const tokens = estimateMessageTokens({ role: "user", content: "hello world" });
    expect(tokens).toBeGreaterThan(0);
  });

  it("adds overhead for tool_calls", () => {
    const plain = estimateMessageTokens({ role: "assistant", content: "x" });
    const withTools = estimateMessageTokens({
      role: "assistant",
      content: "x",
      tool_calls: [{ id: "1", name: "echo", arguments: '{"a":1}' }],
    });
    expect(withTools).toBeGreaterThan(plain);
  });

  it("trimHistoryToTokenBudget keeps recent messages", () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `message number ${i} `.repeat(20),
    }));
    const total = estimateHistoryTokens(messages);
    const trimmed = trimHistoryToTokenBudget(messages, Math.floor(total / 2));
    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed[trimmed.length - 1]?.content).toContain("message number 19");
  });
});
