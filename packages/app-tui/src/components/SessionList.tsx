import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { theme } from "../render/theme.js";
import type { SessionInfo } from "../client/types.js";

type Props = {
  sessions: SessionInfo[];
  onSelect: (sessionKey: string) => void;
  onRename?: (sessionKey: string, title: string) => void;
  onClose: () => void;
};

export function SessionList({ sessions, onSelect, onRename, onClose }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);

  useInput((input, key) => {
    if (renaming !== null) {
      // TextInput owns typing and Enter; Esc backs out of the rename only.
      if (key.escape) setRenaming(null);
      return;
    }
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "r" && onRename) {
      const s = sessions[selectedIndex];
      if (s) setRenaming(s.title ?? "");
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
      {sessions.map((s, i) =>
        renaming !== null && i === selectedIndex ? (
          <Box key={s.sessionKey} gap={1}>
            <Text color={theme.primary}>✎</Text>
            <TextInput
              value={renaming}
              onChange={setRenaming}
              onSubmit={(value) => {
                const title = value.trim();
                setRenaming(null);
                if (title && title !== s.title) onRename?.(s.sessionKey, title);
              }}
            />
          </Box>
        ) : (
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
        ),
      )}
      <Box marginTop={1}>
        <Text color={theme.dim}>
          {renaming !== null ? "enter save · esc cancel" : `↑↓ navigate · enter load${onRename ? " · r rename" : ""} · esc back`}
        </Text>
      </Box>
    </Box>
  );
}
