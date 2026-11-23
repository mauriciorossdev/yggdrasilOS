import { describe, expect, it } from "vitest";
import { slugifyAgentId } from "./AgentManager.js";

describe("slugifyAgentId", () => {
  it("derives a slug from the name, stripping accents", () => {
    expect(slugifyAgentId("Revisor de Código", new Set())).toBe("revisor-de-codigo");
  });
  it("adds a numeric suffix when taken", () => {
    expect(slugifyAgentId("Code Reviewer", new Set(["code-reviewer", "code-reviewer-2"]))).toBe("code-reviewer-3");
  });
  it("falls back to 'agent' for symbols-only names", () => {
    expect(slugifyAgentId("###", new Set())).toBe("agent");
  });
});
