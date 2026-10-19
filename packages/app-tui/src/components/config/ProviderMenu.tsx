import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../../render/theme.js";
import type { ProviderInfo } from "../../client/types.js";

type Props = {
  providers: ProviderInfo[];
  config: Record<string, unknown> | null;
  agentId: string | null;
  onSelect: (providerId: string) => void;
  onBack: () => void;
};

export function ProviderMenu({ providers, config, agentId, onSelect, onBack }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const currentProviderId = agentId
    ? (((config?.agents as Array<Record<string, unknown>> | undefined) ?? []).find((a) => a.id === agentId)
        ?.provider as string | undefined)
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
      setSelectedIndex((i) => Math.min(providers.length - 1, i + 1));
    }
    if (key.return) {
      const provider = providers[selectedIndex];
      if (provider) onSelect(provider.id);
    }
  });

  if (providers.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={theme.dim}>No providers available</Text>
        <Text color={theme.dim}>esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={theme.secondary} bold>
          Select Provider
        </Text>
      </Box>
      {providers.map((p, i) => (
        <Box key={p.id} gap={2}>
          <Text
            color={i === selectedIndex ? theme.primary : theme.text}
            bold={i === selectedIndex}
          >
            {i === selectedIndex ? "▸" : " "} {p.label || p.id}
          </Text>
          <Text color={theme.dim}>
            {p.models.length} model{p.models.length !== 1 ? "s" : ""}
          </Text>
          {p.id === currentProviderId && <Text color={theme.success}>✓ current</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter select · esc back</Text>
      </Box>
    </Box>
  );
}
