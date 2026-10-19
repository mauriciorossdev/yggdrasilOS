import React from "react";
import { Box, Text } from "ink";
import { theme } from "../render/theme.js";
import { MessageItem } from "./MessageItem.js";
import { StreamingMessage } from "./StreamingMessage.js";
import { ToolCallView } from "./ToolCallView.js";
import type { ChatMessage } from "../state/store.js";
import type { ToolExecutePayload } from "../client/types.js";

const INPUT_AND_STATUS_HEIGHT = 6;
const MSG_OVERHEAD_LINES = 2;

function estimateMessageLines(msg: ChatMessage, width: number, cap: number): number {
  const text = msg.text ?? "";
  if (!text) return MSG_OVERHEAD_LINES;
  const wrapped = text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / width)), 0);
  return Math.min(wrapped, cap) + MSG_OVERHEAD_LINES;
}

type Props = {
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isTurnActive: boolean;
  toolCalls: Map<string, ToolExecutePayload>;
  scrollOffset: number;
  terminalRows?: number;
  terminalColumns?: number;
};

export function MessageList({
  messages,
  streamingText,
  isStreaming,
  isTurnActive,
  toolCalls,
  scrollOffset,
  terminalRows = 24,
  terminalColumns = 80,
}: Props): React.ReactElement {
  const maxTotalLines = Math.max(5, terminalRows - INPUT_AND_STATUS_HEIGHT);
  const maxStreamingLines = Math.max(3, maxTotalLines - 2);
  const maxLinesPerMessage = Math.max(5, Math.floor(maxTotalLines / 2));
  const width = Math.max(10, terminalColumns - 6);

  const endIndex = scrollOffset > 0
    ? Math.max(0, messages.length - scrollOffset)
    : messages.length;

  let used = 0;
  let startIndex = endIndex;
  for (let i = endIndex - 1; i >= 0; i--) {
    const lines = estimateMessageLines(messages[i]!, width, maxLinesPerMessage);
    if (used + lines > maxTotalLines && startIndex !== endIndex) break;
    used += lines;
    startIndex = i;
  }

  const visibleMessages = messages.slice(startIndex, endIndex);
  const hiddenAbove = startIndex;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {visibleMessages.length === 0 && !isStreaming && (
        <Box justifyContent="center" paddingY={1}>
          <Text color={theme.dim}>
            Yggdrasil TUI v2 — type a message to start
          </Text>
        </Box>
      )}
      {visibleMessages.map((msg) => (
        <MessageItem key={msg.id} message={msg} maxLines={maxLinesPerMessage} />
      ))}
      <ToolCallView toolCalls={toolCalls} />
      <StreamingMessage
        text={streamingText}
        isActive={isTurnActive && isStreaming}
        maxLines={maxStreamingLines}
      />
      {isTurnActive && !isStreaming && (
        <Box gap={1} marginBottom={1}>
          <Text color={theme.warning}>⟳</Text>
          <Text color={theme.dim}>Thinking…</Text>
        </Box>
      )}
      {(scrollOffset > 0 || hiddenAbove > 0) && (
        <Box justifyContent="center">
          <Text color={theme.dim}>
            ↑ {hiddenAbove + scrollOffset} messages above — Shift+↑↓ to scroll
          </Text>
        </Box>
      )}
    </Box>
  );
}
