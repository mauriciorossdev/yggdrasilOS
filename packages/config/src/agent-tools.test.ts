import { describe, it, expect } from "vitest";
import { isToolAllowedForAgent } from "./index.js";

describe("isToolAllowedForAgent", () => {
  it("allows everything when tools.allow is omitted", () => {
    expect(isToolAllowedForAgent({ id: "a" }, "run_command")).toBe(true);
  });

  it("matches exact names and trailing-* prefixes", () => {
    const agent = { id: "a", tools: { allow: ["phone_*", "remember"] } };
    expect(isToolAllowedForAgent(agent, "phone_set_alarm")).toBe(true);
    expect(isToolAllowedForAgent(agent, "remember")).toBe(true);
    expect(isToolAllowedForAgent(agent, "remember_all")).toBe(false);
    expect(isToolAllowedForAgent(agent, "run_command")).toBe(false);
  });

  it("an empty allowlist means no tools", () => {
    expect(isToolAllowedForAgent({ id: "a", tools: { allow: [] } }, "phone_x")).toBe(false);
  });
});
