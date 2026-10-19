import React from "react";
import { Box, Text } from "ink";
import fuzzysort from "fuzzysort";
import { theme } from "../render/theme.js";
import type { Command } from "./CommandPalette.js";

export function getSlashSuggestions(input: string, commands: Command[]): Command[] {
  if (!input.startsWith("/")) return [];
  const q = input.slice(1);
  if (q === "") return commands;
  const results = fuzzysort.go(q, commands, { key: "name", limit: 5 });
  return results.map((r) => r.obj);
}

type Props = {
  suggestions: Command[];
  selectedIndex: number;
};

export function SlashAutocomplete({ suggestions, selectedIndex }: Props): React.ReactElement | null {
  if (suggestions.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingX={1}>
      {suggestions.map((cmd, i) => (
        <Box key={cmd.name} gap={2}>
          <Text
            color={i === selectedIndex ? theme.primary : theme.text}
            bold={i === selectedIndex}
          >
            /{cmd.name}
          </Text>
          <Text color={theme.dim}>{cmd.description}</Text>
        </Box>
      ))}
    </Box>
  );
}
