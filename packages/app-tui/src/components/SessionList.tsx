import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../render/theme.js";
import type { SessionInfo } from "../client/types.js";

type Props = {
  sessions: SessionInfo[];
  onSelect: (sessionKey: string) => void;
  onClose: () => void;
};

export function SessionList({ sessions, onSelect, onClose }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(sessions.length - 1, i + 1));
    }
    if (key.return) {
      const s = sessions[selectedIndex];
      if (s) onSelect(s.sessionKey);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          ☰ Sessions
        </Text>
      </Box>
      {sessions.length === 0 && (
        <Text color={theme.dim}>No sessions found</Text>
      )}
      {sessions.map((s, i) => (
        <Box key={s.sessionKey} gap={2}>
          <Text
            color={i === selectedIndex ? theme.primary : theme.text}
            bold={i === selectedIndex}
          >
            {i === selectedIndex ? "▸" : " "} {s.title ?? s.sessionKey.slice(-12)}
          </Text>
          <Text color={theme.dim}>{s.messageCount} msgs</Text>
          <Text color={theme.dim}>
            {new Date(s.updatedAt).toLocaleDateString()}
          </Text>
          {s.agentId && <Text color={theme.muted}>{s.agentId}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter load · esc back</Text>
      </Box>
    </Box>
  );
}
