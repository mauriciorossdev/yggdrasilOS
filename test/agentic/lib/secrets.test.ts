import { afterEach, describe, expect, it } from "vitest";
import { clearSecretsForTest, redact, redactDeep, registerSecret } from "./secrets.js";

afterEach(clearSecretsForTest);

describe("redact", () => {
  it("masks every occurrence of a registered secret", () => {
    registerSecret("sk-live-abcdef123456");
    expect(redact("key=sk-live-abcdef123456 and again sk-live-abcdef123456")).toBe("key=[redacted] and again [redacted]");
  });

  it("does nothing when nothing is registered, and ignores blanks and very short values", () => {
    expect(redact("plain text")).toBe("plain text");
    registerSecret("   ");
    registerSecret(undefined);
    registerSecret("abc");
    expect(redact("abc plain text")).toBe("abc plain text");
  });
});

describe("redactDeep", () => {
  it("reaches strings nested in objects and arrays, including tool results", () => {
    registerSecret("sk-live-abcdef123456");
    const report = {
      toolCalls: [{ name: "run_command", result: '{"stdout":"OLLAMA_API_KEY=sk-live-abcdef123456\\n"}' }],
      nested: { list: ["ok", "sk-live-abcdef123456"] },
      count: 3,
    };
    const clean = redactDeep(report);
    expect(JSON.stringify(clean)).not.toContain("sk-live-abcdef123456");
    expect(clean.count).toBe(3);
    expect(clean.nested.list[0]).toBe("ok");
  });

  it("returns the value untouched when there is nothing to hide", () => {
    const value = { a: ["x"] };
    expect(redactDeep(value)).toBe(value);
  });
});
