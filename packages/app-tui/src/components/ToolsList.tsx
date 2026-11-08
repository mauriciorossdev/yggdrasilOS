import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../render/theme.js";
import { visibleWindow } from "../state/window.js";
import type { ToolInfo } from "../client/types.js";

type Props = { tools: ToolInfo[]; onClose: () => void; pageSize?: number };

const RISK_COLOR: Record<string, string> = {
  safe: theme.success,
  moderate: theme.warning,
  destructive: theme.error,
};

export function ToolsList({ tools, onClose, pageSize = 12 }: Props): React.ReactElement {
  const [selected, setSelected] = useState(0);

  useInput((_input, key) => {
    if (key.escape) onClose();
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(tools.length - 1, i + 1));
    else if (key.pageUp) setSelected((i) => Math.max(0, i - pageSize));
    else if (key.pageDown) setSelected((i) => Math.min(tools.length - 1, i + pageSize));
  });

  const { start, end } = visibleWindow(tools.length, selected, pageSize);
  const current = tools[selected];
  const params = current ? Object.keys(current.parameters?.properties ?? {}) : [];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          ⚒ Tools
        </Text>
        <Text color={theme.dim}> ({tools.length})</Text>
      </Box>
      {tools.length === 0 && <Text color={theme.dim}>No tools available</Text>}
      {start > 0 && <Text color={theme.dim}>  ↑ {start} more</Text>}
      {tools.slice(start, end).map((t, offset) => {
        const i = start + offset;
        return (
          <Box key={t.name} gap={2}>
            <Text color={i === selected ? theme.primary : theme.text} bold={i === selected}>
              {i === selected ? "▸" : " "} {t.name}
            </Text>
            {t.kind && <Text color={theme.muted}>{t.kind}</Text>}
            {t.riskLevel && <Text color={RISK_COLOR[t.riskLevel] ?? theme.dim}>{t.riskLevel}</Text>}
          </Box>
        );
      })}
      {end < tools.length && <Text color={theme.dim}>  ↓ {tools.length - end} more</Text>}
      {current && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.text}>{current.description}</Text>
          {params.length > 0 && <Text color={theme.dim}>params: {params.join(", ")}</Text>}
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.dim}>↑↓ navigate · pgup/pgdn page · esc back</Text>
      </Box>
    </Box>
  );
}
