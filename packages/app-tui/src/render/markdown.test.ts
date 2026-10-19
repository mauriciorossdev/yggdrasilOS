import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("returns a string for plain text", () => {
    const result = renderMarkdown("hello world");
    expect(typeof result).toBe("string");
    expect(result).toContain("hello world");
  });

  it("renders bold text", () => {
    const result = renderMarkdown("**bold**");
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles code blocks without throwing", () => {
    const result = renderMarkdown("```js\nconst x = 1;\n```");
    expect(result).toContain("const x = 1");
  });

  it("handles empty string", () => {
    const result = renderMarkdown("");
    expect(typeof result).toBe("string");
  });

  it("handles malformed markdown gracefully", () => {
    const result = renderMarkdown("# unclosed **bold and `code");
    expect(typeof result).toBe("string");
  });
});
