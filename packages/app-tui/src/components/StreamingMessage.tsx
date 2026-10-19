import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { theme } from "../render/theme.js";
import { renderMarkdown } from "../render/markdown.js";

type Props = {
  text: string;
  isActive: boolean;
  maxLines?: number;
};

export function StreamingMessage({ text, isActive, maxLines }: Props): React.ReactElement | null {
  if (!isActive && !text) return null;

  const rendered = text ? renderMarkdown(text) : "";
  let display = rendered;
  let hiddenAbove = 0;

  if (isActive && maxLines && maxLines > 0) {
    const lines = rendered.split("\n");
    if (lines.length > maxLines) {
      hiddenAbove = lines.length - maxLines;
      display = lines.slice(-maxLines).join("\n");
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={theme.assistant} bold>
          ◆ Assistant
        </Text>
        {isActive && (
          <Text color={theme.warning}>
            <Spinner type="dots" />
          </Text>
        )}
      </Box>
      {hiddenAbove > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>↑ {hiddenAbove} lines above — streaming…</Text>
        </Box>
      )}
      <Box marginLeft={2}>
        <Text wrap="wrap">{display}</Text>
      </Box>
    </Box>
  );
}
