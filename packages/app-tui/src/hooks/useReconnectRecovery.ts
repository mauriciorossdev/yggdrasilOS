import { useEffect, useRef } from "react";
import type { GatewayClient } from "../client/gateway-client.js";
import type { ApprovalMode } from "../client/types.js";
import { toChatMessages } from "../state/sessionMessages.js";
import type { ChatMessage, TuiAction } from "../state/store.js";

type RecoveryClient = Pick<GatewayClient, "call">;

/**
 * After the socket came back, rebuilds what the TUI shows from the gateway: events
 * emitted while disconnected (deltas, the final reply, a resolved approval) are gone,
 * but the session record holds everything that was committed. Also re-sends the
 * approval mode so a restarted gateway doesn't silently fall back to "auto".
 */
export async function recoverSession(
  client: RecoveryClient,
  sessionKey: string,
  mode: ApprovalMode,
): Promise<{ messages: ChatMessage[] } | null> {
  void client.call("tools.setApprovalMode", { sessionKey, mode }).catch(() => {});
  const { session } = await client.call<{
    session: { messages: Array<{ role: string; content: string; timestamp?: number }> } | null;
  }>("sessions.get", { sessionKey });
  return session ? { messages: toChatMessages(session.messages) } : null;
}

export function useReconnectRecovery(
  client: GatewayClient,
  dispatch: React.Dispatch<TuiAction>,
  sessionKey: string | null,
  mode: ApprovalMode,
): void {
  const latest = useRef({ sessionKey, mode });
  latest.current = { sessionKey, mode };

  useEffect(() => {
    const onReconnected = () => {
      const { sessionKey: key, mode: currentMode } = latest.current;
      if (!key) return;
      recoverSession(client, key, currentMode).then(
        (recovered) => {
          if (!recovered) {
            dispatch({ type: "ADD_SYSTEM_MESSAGE", text: "Reconnected to the gateway." });
            return;
          }
          dispatch({
            type: "RESYNC_SESSION",
            messages: recovered.messages,
            notice: "Reconnected — the conversation was reloaded from the gateway.",
          });
        },
        (err) => {
          dispatch({
            type: "ADD_SYSTEM_MESSAGE",
            text: `Reconnected, but the conversation could not be reloaded: ${err instanceof Error ? err.message : String(err)}`,
          });
        },
      );
    };
    client.on("reconnected", onReconnected);
    return () => {
      client.off("reconnected", onReconnected);
    };
  }, [client, dispatch]);
}
