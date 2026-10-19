import React from "react";
import { Box, Text } from "ink";
import { theme } from "../render/theme.js";
import type { TuiState } from "../state/store.js";
import type { ApprovalMode } from "../client/types.js";

const MODE_STYLE: Record<ApprovalMode, { glyph: string; color: string }> = {
  auto: { glyph: "◇", color: theme.dim },
  plan: { glyph: "◐", color: theme.secondary },
  restrict: { glyph: "◆", color: theme.warning },
  yolo: { glyph: "●", color: theme.error },
};

type Props = {
  state: TuiState;
};

function contextPercent(state: TuiState): { pct: number; color: string } | null {
  const inputTokens = state.lastUsage?.inputTokens;
  if (!inputTokens) return null;

  const activeAgentId = state.activeAgentId ?? state.defaultAgent;
  const agentInfo = state.agents.find((a) => a.id === activeAgentId);
  if (!agentInfo) return null;

  const providerInfo = state.providers.find((p) => p.id === agentInfo.provider);
  const modelInfo = providerInfo?.models.find((m) => m.id === agentInfo.model);
  const contextWindow = modelInfo?.contextWindow;
  if (!contextWindow) return null;

  const pct = Math.round((inputTokens / contextWindow) * 100);
  const color = pct > 90 ? theme.error : pct > 70 ? theme.warning : theme.success;
  return { pct, color };
}

export function StatusBar({ state }: Props): React.ReactElement {
  const agent = state.activeAgentId ?? state.defaultAgent ?? "—";
  const session = state.sessionKey ? state.sessionKey.slice(-8) : "none";
  const connStatus = state.connected ? "●" : "○";
  const connColor = state.connected ? theme.success : theme.error;
  const ctx = contextPercent(state);

  return (
    <Box
      borderStyle="single"
      borderColor={theme.border}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Text color={connColor}>{connStatus}</Text>
        <Text color={theme.statusBar.fg}>
          agent:<Text color={theme.statusBar.accent}>{agent}</Text>
        </Text>
        <Text color={theme.statusBar.fg}>
          session:<Text color={theme.dim}>{session}</Text>
        </Text>
        {ctx && <Text color={ctx.color}>ctx:{ctx.pct}%</Text>}
      </Box>
      <Box gap={2}>
        <Text color={MODE_STYLE[state.mode].color} bold>
          {MODE_STYLE[state.mode].glyph} {state.mode}
        </Text>
        {state.isTurnActive && (
          <Text color={theme.warning}>⟳ thinking…</Text>
        )}
        {state.turnDurationMs != null && !state.isTurnActive && (
          <Text color={theme.dim}>{state.turnDurationMs}ms</Text>
        )}
        <Text color={theme.dim}>ctrl+k:commands shift+tab:mode esc:back ctrl+c:quit</Text>
      </Box>
    </Box>
  );
}
