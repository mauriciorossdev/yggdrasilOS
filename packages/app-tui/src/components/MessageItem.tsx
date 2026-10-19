import React, { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../render/theme.js";
import { renderMarkdown } from "../render/markdown.js";
import { isUnifiedDiff, parseDiff } from "../render/diff.js";
import type { ChatMessage } from "../state/store.js";

const MAX_DIFF_LINES = 40;
const diffKindColor: Record<string, string> = {
  add: theme.success,
  del: theme.error,
  hunk: theme.secondary,
  meta: theme.dim,
  ctx: theme.dim,
};

type Props = {
  message: ChatMessage;
  maxLines?: number;
};

const roleConfig: Record<string, { label: string; color: string; icon: string }> = {
  user: { label: "You", color: theme.user, icon: "▸" },
  assistant: { label: "Assistant", color: theme.assistant, icon: "◆" },
  system: { label: "System", color: theme.system, icon: "⚙" },
  tool: { label: "Tool", color: theme.tool, icon: "⚡" },
};

function MessageItemImpl({ message, maxLines }: Props): React.ReactElement {
  const cfg = roleConfig[message.role] ?? roleConfig.system!;

  if (message.role === "tool") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box gap={1}>
          <Text color={cfg.color}>
            {cfg.icon} {message.toolName ?? "tool"}
          </Text>
          <Text
            color={
              message.toolStatus === "ok"
                ? theme.success
                : message.toolStatus === "error"
                  ? theme.error
                  : theme.warning
            }
          >
            [{message.toolStatus ?? "done"}]
          </Text>
        </Box>
        {message.text && isUnifiedDiff(message.text) ? (
          <Box flexDirection="column" marginLeft={2}>
            {parseDiff(message.text).slice(0, MAX_DIFF_LINES).map((dl, i) => (
              <Text key={i} color={diffKindColor[dl.kind] ?? theme.dim}>
                {dl.text}
              </Text>
            ))}
            {parseDiff(message.text).length > MAX_DIFF_LINES && (
              <Text color={theme.dim}>… {parseDiff(message.text).length - MAX_DIFF_LINES} more lines</Text>
            )}
          </Box>
        ) : message.text ? (
          <Box marginLeft={2}>
            <Text color={theme.dim} wrap="wrap">
              {message.text.length > 500
                ? message.text.slice(0, 500) + "…"
                : message.text}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  const rendered = message.role === "assistant" ? renderMarkdown(message.text) : message.text;
  let content = rendered;
  let hiddenBelow = 0;

  if (maxLines && maxLines > 0) {
    const lines = rendered.split("\n");
    if (lines.length > maxLines) {
      hiddenBelow = lines.length - maxLines;
      content = lines.slice(0, maxLines).join("\n");
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={cfg.color} bold>
          {cfg.icon} {cfg.label}
        </Text>
        <Text color={theme.dim}>
          {new Date(message.timestamp).toLocaleTimeString()}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text wrap="wrap">{content}</Text>
      </Box>
      {hiddenBelow > 0 && (
        <Box marginLeft={2}>
          <Text color={theme.dim}>… {hiddenBelow} more lines (use /export for full transcript)</Text>
        </Box>
      )}
    </Box>
  );
}

export const MessageItem = memo(MessageItemImpl);
