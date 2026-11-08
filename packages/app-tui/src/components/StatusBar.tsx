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

/** Last path segment of the workspace root ("/a/b/my-app" -> "my-app"), tolerant of Windows separators and trailing slashes. */
export function projectName(root: string | null): string | null {
  if (!root) return null;
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

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
  const session = state.sessionTitle ?? (state.sessionKey ? state.sessionKey.slice(-8) : "none");
  const agentInfo = state.agents.find((a) => a.id === (state.activeAgentId ?? state.defaultAgent));
  const project = projectName(state.workspaceRoot);
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
        {project && (
          <Text color={theme.statusBar.fg}>
            <Text color={theme.statusBar.accent}>{project}</Text>
          </Text>
        )}
        <Text color={theme.statusBar.fg}>
          agent:<Text color={theme.statusBar.accent}>{agent}</Text>
          {agentInfo?.model && <Text color={theme.dim}> ({agentInfo.model})</Text>}
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
        {state.isCancelling ? (
          <Text color={theme.warning}>■ cancelling…</Text>
        ) : state.retryNotice ? (
          <Text color={theme.warning}>
            ↻ retrying in {Math.max(1, Math.round(state.retryNotice.delayMs / 1000))}s ({state.retryNotice.reason}, attempt {state.retryNotice.attempt}){" "}
            <Text color={theme.dim}>(esc to cancel)</Text>
          </Text>
        ) : (
          (state.isTurnActive || state.isStreaming) && (
            <Text color={theme.warning}>⟳ thinking… <Text color={theme.dim}>(esc to cancel)</Text></Text>
          )
        )}
        {state.turnDurationMs != null && !state.isTurnActive && (
          <Text color={theme.dim}>{state.turnDurationMs}ms</Text>
        )}
        <Text color={theme.dim}>ctrl+k:commands shift+tab:mode esc:back/cancel ctrl+c:cancel/quit</Text>
      </Box>
    </Box>
  );
}
