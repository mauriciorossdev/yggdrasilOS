import { useEffect, useRef } from "react";
import type { GatewayClient } from "../client/gateway-client.js";
import type {
  ApprovalModeChangedPayload,
  ChatDeltaPayload,
  ChatFinalPayload,
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  ToolExecutePayload,
  TurnEndPayload,
  TurnStartPayload,
} from "../client/types.js";
import type { TuiAction } from "../state/store.js";

export function useGatewayEvents(
  client: GatewayClient,
  dispatch: React.Dispatch<TuiAction>,
  sessionKey: string | null,
): void {
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    const matchesSession = (p: { sessionKey?: string }) =>
      !p.sessionKey || p.sessionKey === sessionKeyRef.current;

    const onConnected = () => dispatch({ type: "SET_CONNECTED", connected: true });
    const onDisconnected = () => dispatch({ type: "SET_CONNECTED", connected: false });
    const onDelta = (p: ChatDeltaPayload) => matchesSession(p) && dispatch({ type: "CHAT_DELTA", payload: p });
    const onFinal = (p: ChatFinalPayload) => matchesSession(p) && dispatch({ type: "CHAT_FINAL", payload: p });
    const onTurnStart = (p: TurnStartPayload) => matchesSession(p) && dispatch({ type: "TURN_START", payload: p });
    const onTurnEnd = (p: TurnEndPayload) => matchesSession(p) && dispatch({ type: "TURN_END", payload: p });
    const onToolExec = (p: ToolExecutePayload) => matchesSession(p) && dispatch({ type: "TOOL_EXECUTE", payload: p });
    const onApprovalReq = (p: ToolApprovalRequestedPayload) =>
      matchesSession(p) && dispatch({ type: "TOOL_APPROVAL_REQUESTED", payload: p });
    const onApprovalRes = (p: ToolApprovalResolvedPayload) =>
      matchesSession(p) && dispatch({ type: "TOOL_APPROVAL_RESOLVED", payload: p });
    const onModeChanged = (p: ApprovalModeChangedPayload) =>
      matchesSession(p) && dispatch({ type: "SET_MODE", mode: p.mode });

    client.on("connected", onConnected);
    client.on("disconnected", onDisconnected);
    client.on("chat.delta", onDelta);
    client.on("chat.final", onFinal);
    client.on("turn.start", onTurnStart);
    client.on("turn.end", onTurnEnd);
    client.on("tool.execute", onToolExec);
    client.on("tool.approval.requested", onApprovalReq);
    client.on("tool.approval.resolved", onApprovalRes);
    client.on("tools.approvalMode.changed", onModeChanged);

    return () => {
      client.off("connected", onConnected);
      client.off("disconnected", onDisconnected);
      client.off("chat.delta", onDelta);
      client.off("chat.final", onFinal);
      client.off("turn.start", onTurnStart);
      client.off("turn.end", onTurnEnd);
      client.off("tool.execute", onToolExec);
      client.off("tool.approval.requested", onApprovalReq);
      client.off("tool.approval.resolved", onApprovalRes);
      client.off("tools.approvalMode.changed", onModeChanged);
    };
  }, [client, dispatch]);
}
