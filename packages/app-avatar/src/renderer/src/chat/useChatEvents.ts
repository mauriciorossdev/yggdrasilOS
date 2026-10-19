import { useEffect, useRef } from "react";
import type { GatewayWsEvent } from "@yggdrasil/client-web";
import type {
  ChatDeltaPayload,
  ChatFinalPayload,
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  ToolExecutePayload,
  TurnEndPayload,
} from "../types.js";
import type { ChatAction } from "./chatReducer.js";

export function useChatEvents(
  onEvent: (handler: (ev: GatewayWsEvent) => void) => () => void,
  dispatch: React.Dispatch<ChatAction>,
  sessionKey: string | null,
): void {
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  useEffect(() => {
    const matchesSession = (p: { sessionKey?: string }) => !p.sessionKey || p.sessionKey === sessionKeyRef.current;

    return onEvent((ev) => {
      switch (ev.event) {
        case "chat.delta": {
          const p = ev.payload as ChatDeltaPayload;
          if (matchesSession(p)) dispatch({ type: "CHAT_DELTA", payload: p });
          break;
        }
        case "chat.final": {
          const p = ev.payload as ChatFinalPayload;
          if (matchesSession(p)) dispatch({ type: "CHAT_FINAL", payload: p });
          break;
        }
        case "turn.start": {
          const p = ev.payload as { sessionKey?: string };
          if (matchesSession(p)) dispatch({ type: "TURN_START" });
          break;
        }
        case "turn.end": {
          const p = ev.payload as TurnEndPayload;
          if (matchesSession(p)) dispatch({ type: "TURN_END", payload: p });
          break;
        }
        case "tool.execute": {
          const p = ev.payload as ToolExecutePayload;
          if (matchesSession(p)) dispatch({ type: "TOOL_EXECUTE", payload: p });
          break;
        }
        case "tool.approval.requested": {
          const p = ev.payload as ToolApprovalRequestedPayload;
          if (matchesSession(p)) dispatch({ type: "TOOL_APPROVAL_REQUESTED", payload: p });
          break;
        }
        case "tool.approval.resolved": {
          const p = ev.payload as ToolApprovalResolvedPayload;
          if (matchesSession(p)) dispatch({ type: "TOOL_APPROVAL_RESOLVED", payload: p });
          break;
        }
        default:
          break;
      }
    });
  }, [onEvent, dispatch]);
}
