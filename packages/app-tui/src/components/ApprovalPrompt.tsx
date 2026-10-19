import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../render/theme.js";
import type { PendingApproval } from "../state/store.js";

type Props = {
  approval: PendingApproval;
  onRespond: (requestId: string, approved: boolean) => void;
};

export function ApprovalPrompt({ approval, onRespond }: Props): React.ReactElement {
  const handleResponse = useCallback(
    (approved: boolean) => {
      onRespond(approval.requestId, approved);
    },
    [approval.requestId, onRespond],
  );

  useInput((input) => {
    if (input === "y" || input === "Y") handleResponse(true);
    if (input === "n" || input === "N" || input === "q") handleResponse(false);
  });

  const riskColor =
    approval.riskLevel === "destructive"
      ? theme.error
      : approval.riskLevel === "moderate"
        ? theme.warning
        : theme.muted;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={theme.warning}
      paddingX={1}
      paddingY={0}
    >
      <Box gap={1}>
        <Text color={theme.warning} bold>
          ⚠ Tool Approval Required
        </Text>
        {approval.riskLevel && (
          <Text color={riskColor}>[{approval.riskLevel}]</Text>
        )}
      </Box>
      <Box marginTop={1} gap={1}>
        <Text color={theme.tool} bold>
          {approval.toolName}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={theme.dim} wrap="wrap">
          {JSON.stringify(approval.args, null, 2)}
        </Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color={theme.success} bold>
          [y] Approve
        </Text>
        <Text color={theme.error} bold>
          [n] Deny
        </Text>
      </Box>
    </Box>
  );
}
