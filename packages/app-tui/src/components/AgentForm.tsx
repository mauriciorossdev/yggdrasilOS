import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../render/theme.js";
import type { GatewayClient } from "../client/gateway-client.js";
import type { AgentCreateResult, ProviderInfo } from "../client/types.js";
import { ProviderMenu } from "./config/ProviderMenu.js";
import { ModelMenu } from "./config/ModelMenu.js";

type Props = {
  providers: ProviderInfo[];
  client: GatewayClient;
  onCreated: (message: string) => void;
  onBack: () => void;
};

type Step = "id" | "label" | "provider" | "model" | "systemPrompt" | "scope";

const STEP_ORDER: Step[] = ["id", "label", "provider", "model", "systemPrompt", "scope"];

const SCOPE_OPTIONS: Array<{ id: "local" | "global"; label: string; hint: string }> = [
  { id: "local", label: "Local to this project", hint: "saved in this project's yggdrasil.config.json" },
  { id: "global", label: "Global (all projects)", hint: "saved under ~/.yggdrasil/agents.json" },
];

export function AgentForm({ providers, client, onCreated, onBack }: Props): React.ReactElement {
  const [step, setStep] = useState<Step>("id");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  function stepBack(): void {
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) {
      onBack();
      return;
    }
    setStep(STEP_ORDER[idx - 1]!);
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
          Label (optional)
        </Text>
        <TextInput value={label} onChange={setLabel} placeholder="e.g. Code Reviewer" onSubmit={() => setStep("provider")} />
        <Text color={theme.dim}>enter to continue · esc back</Text>
      </Box>
    );
  }

  if (step === "provider") {
    return (
      <ProviderMenu
        providers={providers}
        config={null}
        agentId={null}
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
        config={null}
        agentId={null}
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
          value={systemPrompt}
          onChange={setSystemPrompt}
          placeholder="Instructions for this agent…"
          onSubmit={(v) => {
            if (v.trim()) setStep("scope");
          }}
        />
        <Text color={theme.dim}>enter to continue · esc back</Text>
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
