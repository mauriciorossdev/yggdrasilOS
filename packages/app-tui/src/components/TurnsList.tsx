import React from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../render/theme.js";
import type { TurnLogEntry } from "../client/types.js";

type Props = { turns: TurnLogEntry[]; currentSessionKey: string | null; onClose: () => void; limit?: number };

const CLASS_COLOR: Record<string, string> = {
  ok: theme.success,
  error: theme.error,
  retry: theme.warning,
  fallback: theme.warning,
  cancelled: theme.dim,
};

export function TurnsList({ turns, currentSessionKey, onClose, limit = 15 }: Props): React.ReactElement {
  useInput((_input, key) => {
    if (key.escape) onClose();
  });

  // The gateway returns oldest first; the newest are what matter.
  const shown = [...turns].reverse().slice(0, limit);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.primary} bold>
          ⏱ Recent turns
        </Text>
        <Text color={theme.dim}> (gateway-wide, newest first)</Text>
      </Box>
      {shown.length === 0 && <Text color={theme.dim}>No turns recorded since the gateway started</Text>}
      {shown.map((t, i) => (
        <Box key={`${t.timestamp}-${i}`} gap={2}>
          <Text color={theme.dim}>{new Date(t.timestamp).toLocaleTimeString()}</Text>
          <Text color={CLASS_COLOR[t.classification ?? ""] ?? theme.text}>{t.classification ?? "?"}</Text>
          {t.durationMs != null && <Text color={theme.dim}>{t.durationMs}ms</Text>}
          <Text color={t.sessionKey === currentSessionKey ? theme.accent : theme.muted}>
            {t.sessionKey === currentSessionKey ? "this session" : t.sessionKey.slice(-12)}
          </Text>
          {t.harnessId && <Text color={theme.muted}>{t.harnessId}</Text>}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.dim}>esc back</Text>
      </Box>
    </Box>
  );
}
