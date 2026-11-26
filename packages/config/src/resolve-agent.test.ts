import { describe, expect, it } from "vitest";
import { resolveAgent, type YggdrasilConfig } from "./index.js";

const agents = [
  { id: "default", label: "Default", provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  { id: "plan", label: "Plan", provider: "openai-compat", model: "gpt-4o-mini" },
];

describe("resolveAgent", () => {
  it("returns the requested agent", () => {
    expect(resolveAgent({ agents } as YggdrasilConfig, "plan").id).toBe("plan");
  });

  it("falls back to the default agent instead of an empty one for an agent this gateway lacks", () => {
    const agent = resolveAgent({ agents, defaultAgent: "plan" } as YggdrasilConfig, "assistant");
    expect(agent.id).toBe("plan");
    expect(agent.provider).toBe("openai-compat");
  });

  it("uses an agent called default, then the first one, when defaultAgent is unset or missing", () => {
    expect(resolveAgent({ agents } as YggdrasilConfig, "assistant").id).toBe("default");
    expect(resolveAgent({ agents: [agents[1]!], defaultAgent: "gone" } as YggdrasilConfig).id).toBe("plan");
  });

  it("keeps the empty agent only when no agent is configured at all", () => {
    expect(resolveAgent({} as YggdrasilConfig, "assistant")).toEqual({ id: "assistant", label: "assistant" });
  });
});
