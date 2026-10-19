import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { theme } from "../render/theme.js";
import type { ToolExecutePayload } from "../client/types.js";

type Props = {
  toolCalls: Map<string, ToolExecutePayload>;
};

export function ToolCallView({ toolCalls }: Props): React.ReactElement | null {
  const running = [...toolCalls.values()].filter((t) => t.status === "running");
  if (running.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {running.map((tool, i) => (
        <Box key={i} gap={1}>
          <Text color={theme.tool}>
            <Spinner type="dots" />
          </Text>
          <Text color={theme.tool} bold>
            {tool.toolName}
          </Text>
          {tool.args && (
            <Text color={theme.dim}>
              {JSON.stringify(tool.args).slice(0, 80)}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
