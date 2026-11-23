import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../render/theme.js";
import type { GatewayClient } from "../client/gateway-client.js";
import type { AgentCreateResult, AgentInfo, ProviderInfo } from "../client/types.js";
import { ProviderMenu } from "./config/ProviderMenu.js";
import { ModelMenu } from "./config/ModelMenu.js";

type Props = {
  providers: ProviderInfo[];
  client: GatewayClient;
  onCreated: (message: string) => void;
  onBack: () => void;
  /**
   * Edit this agent instead of creating one: the form starts filled in, skips the id
   * (it's the agent's identity) and the scope (an edit stays where the agent lives),
   * and saves with agents.update. Must be the full agent from agents.get — agents.list
   * clips systemPrompt to 200 chars.
   */
  editing?: AgentInfo & { scope: "local" | "global" };
};

type Step = "id" | "label" | "provider" | "model" | "systemPrompt" | "scope";

const STEP_ORDER: Step[] = ["id", "label", "provider", "model", "systemPrompt", "scope"];
const EDIT_STEP_ORDER: Step[] = ["label", "provider", "model", "systemPrompt"];

const SCOPE_OPTIONS: Array<{ id: "local" | "global"; label: string; hint: string }> = [
  { id: "local", label: "Local to this project", hint: "saved in this project's yggdrasil.config.json" },
  { id: "global", label: "Global (all projects)", hint: "saved under ~/.yggdrasil/agents.json" },
];

export function AgentForm({ providers, client, onCreated, onBack, editing }: Props): React.ReactElement {
  // With no providers listed there's nothing to pick from: an edit keeps the agent's current ones.
  const order = editing
    ? providers.length > 0
      ? EDIT_STEP_ORDER
      : EDIT_STEP_ORDER.filter((s) => s !== "provider" && s !== "model")
    : STEP_ORDER;
  const [step, setStep] = useState<Step>(order[0]!);
  const [id, setId] = useState(editing?.id ?? "");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [providerId, setProviderId] = useState<string | null>(editing?.provider ?? null);
  const [modelId, setModelId] = useState<string | null>(editing?.model ?? null);
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt ?? "");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Lets the provider/model menus start on (and mark) the agent's current choice.
  const editingConfig = editing ? { agents: [editing] } : null;

  function stepBack(): void {
    const idx = order.indexOf(step);
    if (idx <= 0) {
      onBack();
      return;
    }
    setStep(order[idx - 1]!);
  }

  useInput((_input, key) => {
    if (key.escape) {
      stepBack();
      return;
    }
    if (step === "scope" && !submitting) {
      if (key.upArrow) setScopeIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setScopeIndex((i) => Math.min(SCOPE_OPTIONS.length - 1, i + 1));
      if (key.return) void submit(SCOPE_OPTIONS[scopeIndex]!.id);
    }
  });

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    setSubmitting(true);
    try {
      // Every field is sent (harness included) so the update keeps what this form doesn't show.
      const result = await client.call<AgentCreateResult>("agents.update", {
        id: editing.id,
        scope: editing.scope,
        label: label.trim() || undefined,
        provider: providerId ?? undefined,
        model: modelId ?? undefined,
        harness: editing.harness,
        systemPrompt: systemPrompt.trim(),
      });
      onCreated(`✓ Updated agent "${result.agent.id}" (${editing.scope})`);
    } catch (err) {
      onCreated(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(scope: "local" | "global"): Promise<void> {
    setSubmitting(true);
    try {
      const result = await client.call<AgentCreateResult>("agents.create", {
        id: id.trim(),
        label: label.trim() || undefined,
        provider: providerId ?? undefined,
        model: modelId ?? undefined,
        systemPrompt: systemPrompt.trim(),
        scope,
      });
      onCreated(`✓ Created agent "${result.agent.id}" (${scope})`);
    } catch (err) {
      onCreated(`✗ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "id") {
    return (
      <Box flexDirection="column">
        <Text color={theme.secondary} bold>
          New Agent — id
        </Text>
        <TextInput
          key="id"
          value={id}
          onChange={setId}
          placeholder="e.g. code-reviewer"
          onSubmit={(v) => {
            if (v.trim()) setStep("label");
          }}
        />
        <Text color={theme.dim}>enter to continue · esc to cancel</Text>
      </Box>
    );
  }

  if (step === "label") {
    return (
      <Box flexDirection="column">
        <Text color={theme.secondary} bold>
          {editing ? `Edit agent "${editing.id}" (${editing.scope}) — label` : "Label (optional)"}
        </Text>
        <TextInput
          key="label"
          value={label}
          onChange={setLabel}
          placeholder="e.g. Code Reviewer"
          onSubmit={() => setStep(order[order.indexOf("label") + 1]!)}
        />
        <Text color={theme.dim}>enter to continue · esc {editing ? "cancel" : "back"}</Text>
      </Box>
    );
  }

  if (step === "provider") {
    return (
      <ProviderMenu
        providers={providers}
        config={editingConfig}
        agentId={editing?.id ?? null}
        onSelect={(pid) => {
          setProviderId(pid);
          setStep("model");
        }}
        onBack={stepBack}
      />
    );
  }

  if (step === "model") {
    const provider = providers.find((p) => p.id === providerId) ?? null;
    return (
      <ModelMenu
        provider={provider}
        client={client}
        config={editingConfig}
        agentId={editing?.id ?? null}
        onSelect={(mid) => {
          setModelId(mid);
          setStep("systemPrompt");
        }}
        onBack={stepBack}
      />
    );
  }

  if (step === "systemPrompt") {
    return (
      <Box flexDirection="column">
        <Text color={theme.secondary} bold>
          System prompt
        </Text>
        <TextInput
          // Own key per step: React would otherwise reuse the previous step's input and
          // keep its cursor position, so typing would land in the middle of the prompt.
          key="systemPrompt"
          value={systemPrompt}
          onChange={setSystemPrompt}
          placeholder="Instructions for this agent…"
          onSubmit={(v) => {
            if (!v.trim() || submitting) return;
            if (editing) void saveEdit();
            else setStep("scope");
          }}
        />
        <Text color={theme.dim}>
          {submitting ? "Saving…" : editing ? "enter to save · esc back" : "enter to continue · esc back"}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.secondary} bold>
        {submitting ? "Saving…" : "Save agent — where?"}
      </Text>
      {SCOPE_OPTIONS.map((opt, i) => (
        <Box key={opt.id} gap={2}>
          <Text color={i === scopeIndex ? theme.primary : theme.text} bold={i === scopeIndex}>
            {i === scopeIndex ? "▸" : " "} {opt.label}
          </Text>
          <Text color={theme.dim}>{opt.hint}</Text>
        </Box>
      ))}
      <Text color={theme.dim}>↑↓ choose · enter save · esc back</Text>
    </Box>
  );
}
