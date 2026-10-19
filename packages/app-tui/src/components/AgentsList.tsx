import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../render/theme.js";
import type { AgentInfo } from "../client/types.js";

type Props = {
  agents: AgentInfo[];
  activeAgentId: string | null;
  onSelect: (agentId: string) => void;
  onCreate: () => void;
  onClose: () => void;
};

export function AgentsList({ agents, activeAgentId, onSelect, onCreate, onClose }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rowCount = agents.length + 1; // +1 for "create new"

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(rowCount - 1, i + 1));
    }
    if (key.return) {
      if (selectedIndex === 0) {
        onCreate();
        return;
      }
      const agent = agents[selectedIndex - 1];
      if (agent) onSelect(agent.id);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          ◆ Agents
        </Text>
      </Box>
      <Box gap={2}>
        <Text color={selectedIndex === 0 ? theme.primary : theme.text} bold={selectedIndex === 0}>
          {selectedIndex === 0 ? "▸" : " "} + Create new agent
        </Text>
      </Box>
      {agents.map((a, i) => (
        <Box key={a.id} gap={2}>
          <Text color={i + 1 === selectedIndex ? theme.primary : theme.text} bold={i + 1 === selectedIndex}>
            {i + 1 === selectedIndex ? "▸" : " "} {a.label ?? a.id}
            {a.id === activeAgentId ? " (active)" : ""}
          </Text>
          <Text color={theme.dim}>
            {a.provider ?? "?"}/{a.model ?? "?"}
          </Text>
          {a.scope && <Text color={theme.muted}>{a.scope}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter select/create · esc back</Text>
      </Box>
    </Box>
  );
}
