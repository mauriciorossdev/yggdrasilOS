import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../../render/theme.js";
import type { GatewayClient } from "../../client/gateway-client.js";
import type { ProviderInfo } from "../../client/types.js";
import { ProviderMenu } from "./ProviderMenu.js";
import { ModelMenu } from "./ModelMenu.js";
import { ApiKeyForm } from "./ApiKeyForm.js";

type ConfigView = "root" | "provider" | "model" | "apikey";

type MenuItem = {
  id: ConfigView;
  label: string;
  description: string;
  icon: string;
};

const menuItems: MenuItem[] = [
  { id: "provider", label: "Provider", description: "Select LLM provider", icon: "☁" },
  { id: "model", label: "Model", description: "Select model for active agent", icon: "◈" },
  { id: "apikey", label: "API Key", description: "Set provider API key", icon: "🔑" },
];

type Props = {
  client: GatewayClient;
  providers: ProviderInfo[];
  config: Record<string, unknown> | null;
  /** The agent "Model" actually applies to — the active agent, not a hardcoded "default". */
  agentId: string | null;
  onClose: () => void;
  onConfigChanged: () => void;
  initialView?: { view: ConfigView; providerId?: string };
};

export function ConfigMenu({
  client,
  providers,
  config,
  agentId,
  onClose,
  onConfigChanged,
  initialView,
}: Props): React.ReactElement {
  const [view, setView] = useState<ConfigView>(initialView?.view ?? "root");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(
    initialView?.providerId ?? null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useInput((_input, key) => {
    if (view !== "root") return;

    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(menuItems.length - 1, i + 1));
    }
    if (key.return) {
      const item = menuItems[selectedIndex];
      if (item) setView(item.id);
    }
  });

  const breadcrumb =
    view === "root" ? "Configuration" : `Configuration › ${menuItems.find((m) => m.id === view)?.label ?? view}`;

  const currentAgent = agentId
    ? ((config?.agents as Array<Record<string, unknown>> | undefined) ?? []).find((a) => a.id === agentId)
    : undefined;
  const currentProviderId = currentAgent?.provider as string | undefined;
  const currentProvider = providers.find((p) => p.id === currentProviderId);
  const currentModelId = currentAgent?.model as string | undefined;
  const currentModel = currentProvider?.models.find((m) => m.id === currentModelId);

  const providersConfig = (config?.providers as Record<string, { apiKey?: string }> | undefined) ?? {};
  const keyedProviderCount = providers.filter((p) => providersConfig[p.id]?.apiKey).length;

  const currentValueByItem: Record<ConfigView, string> = {
    root: "",
    provider: currentProvider ? `Currently: ${currentProvider.label || currentProvider.id}` : "Select LLM provider",
    model: currentModel ? `Currently: ${currentModel.label || currentModel.id}` : "Select model for active agent",
    apikey:
      providers.length > 0
        ? `${keyedProviderCount}/${providers.length} provider${providers.length !== 1 ? "s" : ""} configured`
        : "Set provider API key",
  };

  if (view === "provider") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} width="100%">
        <Text color={theme.dim}>{breadcrumb}</Text>
        <ProviderMenu
          providers={providers}
          config={config}
          agentId={agentId}
          onSelect={(providerId) => {
            setSelectedProvider(providerId);
            setView("model");
          }}
          onBack={() => setView("root")}
        />
      </Box>
    );
  }

  if (view === "model") {
    const provider = providers.find((p) => p.id === selectedProvider);
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} width="100%">
        <Text color={theme.dim}>{breadcrumb}</Text>
        <ModelMenu
          provider={provider ?? null}
          client={client}
          config={config}
          agentId={agentId}
          onSelect={async (modelId) => {
            if (!agentId) {
              setStatusMessage("✗ No active agent to set a model for");
              setView("root");
              return;
            }
            try {
              // config.patch takes its patch fields flat at the top level
              // (no wrapping "patch" key — that itself is a forbidden key),
              // and agents is an array merged by id, not an id-keyed object.
              // Spread the agent's existing record so unrelated fields
              // (label, systemPrompt, harness, ...) survive the patch.
              const existing = ((config?.agents as Array<Record<string, unknown>> | undefined) ?? []).find(
                (a) => a.id === agentId,
              );
              const result = await client.call<{ ok: true; requiresRestart: boolean }>("config.patch", {
                agents: [{ ...existing, id: agentId, provider: selectedProvider, model: modelId }],
              });
              onConfigChanged();
              if (result.requiresRestart) {
                setStatusMessage("⚠ Restart required for changes to take effect");
              } else {
                setStatusMessage(`✓ Model set to ${modelId}`);
              }
              setView("root");
            } catch (err) {
              setStatusMessage(`✗ ${err instanceof Error ? err.message : String(err)}`);
              setView("root");
            }
          }}
          onBack={() => setView("provider")}
        />
      </Box>
    );
  }

  if (view === "apikey") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} width="100%">
        <Text color={theme.dim}>{breadcrumb}</Text>
        <ApiKeyForm
          providers={providers}
          client={client}
          config={config}
          onSaved={(msg) => {
            setStatusMessage(msg);
            onConfigChanged();
            setView("root");
          }}
          onBack={() => setView("root")}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1} width="100%">
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          ⚙ {breadcrumb}
        </Text>
      </Box>
      {statusMessage && (
        <Box marginBottom={1}>
          <Text color={statusMessage.startsWith("✗") ? theme.error : theme.success}>
            {statusMessage}
          </Text>
        </Box>
      )}
      <Box flexDirection="column">
        {menuItems.map((item, i) => (
          <Box key={item.id} gap={2}>
            <Text
              color={i === selectedIndex ? theme.primary : theme.text}
              bold={i === selectedIndex}
            >
              {i === selectedIndex ? "▸" : " "} {item.icon} {item.label}
            </Text>
            <Text color={theme.dim}>{currentValueByItem[item.id]}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter select · esc back</Text>
      </Box>
    </Box>
  );
}
