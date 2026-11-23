import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { AgentsList } from "./AgentsList.js";
import { AgentForm } from "./AgentForm.js";
import type { GatewayClient } from "../client/gateway-client.js";
import type { ProviderInfo } from "../client/types.js";

const tick = () => new Promise((r) => setTimeout(r, 80));
const ENTER = "\r";
const DOWN = "\u001B[B";

const agents = [
  { id: "default", provider: "anthropic", model: "haiku", scope: "local" as const },
  { id: "reviewer", provider: "ollama", model: "qwen", scope: "global" as const },
];

describe("AgentsList edit", () => {
  it("e edits the highlighted agent, not the create row", async () => {
    const onEdit = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(AgentsList, { agents, activeAgentId: null, onSelect: vi.fn(), onCreate: vi.fn(), onEdit, onClose: vi.fn() }),
    );
    await tick();
    expect(lastFrame()).toContain("e edit");
    stdin.write("e");
    await tick();
    expect(onEdit).not.toHaveBeenCalled();
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write("e");
    await tick();
    expect(onEdit).toHaveBeenCalledWith(agents[1]);
  });
});

describe("AgentForm editing", () => {
  const providers: ProviderInfo[] = [
    { id: "anthropic", label: "Anthropic", models: [{ id: "haiku", label: "Haiku" }] },
    { id: "ollama", label: "Ollama", models: [{ id: "llama", label: "Llama" }, { id: "qwen", label: "Qwen" }] },
  ] as ProviderInfo[];

  it("starts filled in, keeps provider/model on enter, and saves with agents.update in the agent's scope", async () => {
    const call = vi.fn().mockResolvedValue({ agent: { id: "reviewer" } });
    const client = { call } as unknown as GatewayClient;
    const onCreated = vi.fn();
    // A prompt longer than the label: typing must land at its end, not at the label's length.
    const editing = { id: "reviewer", label: "Reviewer", provider: "ollama", model: "qwen", harness: "llm", systemPrompt: "old prompt text", scope: "global" as const };
    const { stdin, lastFrame } = render(
      React.createElement(AgentForm, { providers, client, onCreated, onBack: vi.fn(), editing }),
    );
    await tick();
    expect(lastFrame()).toContain('Edit agent "reviewer" (global)');
    stdin.write(ENTER); // label
    await tick();
    stdin.write(ENTER); // provider: starts on ollama
    await tick();
    stdin.write(ENTER); // model: starts on qwen
    await tick();
    stdin.write(" and new");
    await tick();
    stdin.write(ENTER); // system prompt → save
    await tick();
    expect(call).toHaveBeenCalledWith("agents.update", {
      id: "reviewer",
      scope: "global",
      label: "Reviewer",
      provider: "ollama",
      model: "qwen",
      harness: "llm",
      systemPrompt: "old prompt text and new",
    });
    expect(onCreated).toHaveBeenCalledWith('✓ Updated agent "reviewer" (global)');
  });

  it("skips provider and model when none are listed, keeping the agent's", async () => {
    const call = vi.fn().mockResolvedValue({ agent: { id: "reviewer" } });
    const editing = { id: "reviewer", provider: "ollama", model: "qwen", systemPrompt: "old", scope: "local" as const };
    const { stdin } = render(
      React.createElement(AgentForm, { providers: [], client: { call } as unknown as GatewayClient, onCreated: vi.fn(), onBack: vi.fn(), editing }),
    );
    await tick();
    stdin.write(ENTER); // label → system prompt
    await tick();
    stdin.write(ENTER); // save
    await tick();
    expect(call).toHaveBeenCalledWith("agents.update", expect.objectContaining({ provider: "ollama", model: "qwen", scope: "local" }));
  });
});
