import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../../render/theme.js";
import type { GatewayClient } from "../../client/gateway-client.js";
import type { ProviderInfo } from "../../client/types.js";

type Props = {
  provider: ProviderInfo | null;
  client: GatewayClient;
  config: Record<string, unknown> | null;
  agentId: string | null;
  onSelect: (modelId: string) => void;
  onBack: () => void;
};

export function ModelMenu({ provider, client: _client, config, agentId, onSelect, onBack }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const models = provider?.models ?? [];

  const currentAgent = agentId
    ? ((config?.agents as Array<Record<string, unknown>> | undefined) ?? []).find((a) => a.id === agentId)
    : undefined;
  const currentModelId =
    currentAgent && provider && currentAgent.provider === provider.id
      ? (currentAgent.model as string | undefined)
      : undefined;

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(models.length - 1, i + 1));
    }
    if (key.return) {
      const model = models[selectedIndex];
      if (model) onSelect(model.id);
    }
  });

  if (!provider) {
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>No provider selected</Text>
        <Text color={theme.dim}>esc to go back</Text>
      </Box>
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>No models for {provider.label || provider.id}</Text>
        <Text color={theme.dim}>esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={theme.secondary} bold>
          {provider.label || provider.id} — Select Model
        </Text>
      </Box>
      {models.map((model, i) => (
        <Box key={model.id} gap={2}>
          <Text
            color={i === selectedIndex ? theme.primary : theme.text}
            bold={i === selectedIndex}
          >
            {i === selectedIndex ? "▸" : " "} {model.label || model.id}
          </Text>
          {model.contextWindow && (
            <Text color={theme.dim}>{Math.round(model.contextWindow / 1000)}k ctx</Text>
          )}
          {model.supportsTools && (
            <Text color={theme.muted}>🔧</Text>
          )}
          {model.id === currentModelId && <Text color={theme.success}>✓ current</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter select · esc back</Text>
      </Box>
    </Box>
  );
}
