import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import fuzzysort from "fuzzysort";
import { theme } from "../render/theme.js";

export type Command = {
  name: string;
  description: string;
  shortcut?: string;
  action: () => void;
};

type Props = {
  commands: Command[];
  onClose: () => void;
};

export function CommandPalette({ commands, onClose }: Props): React.ReactElement {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const results = fuzzysort.go(query, commands, { key: "name", limit: 10 });
    return results.map((r) => r.obj);
  }, [query, commands]);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1));
    }
    if (key.return) {
      const cmd = filtered[selectedIndex];
      if (cmd) {
        onClose();
        cmd.action();
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.primary}
      paddingX={1}
      width="60%"
    >
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          ⌘ Command Palette
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={theme.muted}>{"❯ "}</Text>
        <TextInput
          value={query}
          onChange={(val) => {
            setQuery(val);
            setSelectedIndex(0);
          }}
          placeholder="Search commands…"
        />
      </Box>
      <Box flexDirection="column">
        {filtered.map((cmd, i) => (
          <Box key={cmd.name} gap={2}>
            <Text
              color={i === selectedIndex ? theme.primary : theme.text}
              bold={i === selectedIndex}
            >
              {i === selectedIndex ? "▸" : " "} {cmd.name}
            </Text>
            <Text color={theme.dim}>{cmd.description}</Text>
            {cmd.shortcut && <Text color={theme.muted}>{cmd.shortcut}</Text>}
          </Box>
        ))}
        {filtered.length === 0 && (
          <Text color={theme.dim}>No matching commands</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · enter run · esc back</Text>
      </Box>
    </Box>
  );
}
